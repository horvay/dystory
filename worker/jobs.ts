// Background jobs for the production AI: renders, TTS batches, anything that
// outlives a turn. B70 work is submitted to the b70q queue (~/b70/queue/README.md),
// which runs it in its own unit when its turn comes. Everything else runs as a
// transient systemd user unit. Either way it's outside the app's own service,
// so restarting Dystory doesn't kill a render, and the exit code lands next to
// the log, which is how the director learns how it ended.
import { mkdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

async function run(cmd: string[]) {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { out: out.trim(), err: err.trim(), code };
}

const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export type Job = { unit: string; log: string; queue?: string };

/** Jobs on the b70q queue are recorded as `b70q:<ticket id>` where other jobs have their unit name. */
const B70Q = "b70q:";
const SOCKET = `${process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid?.() ?? 1000}`}/b70q.sock`;

async function b70q(method: string, path: string, body?: unknown) {
  const res = await fetch(`http://b70q${path}`, {
    unix: SOCKET,
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  } as RequestInit);
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new Error(`b70q ${method} ${path}: ${data?.error ?? res.status}`);
  return data;
}

const ENV_KEYS = ["PATH", "HOME", "LANG", "USER", "XDG_RUNTIME_DIR"];

/** Whether a command needs the B70: asked for, or it takes the lease itself. */
export const usesB70 = (command: string, gpu?: string) => gpu === "b70" || /\bb70-lease\b|\bb70q\b/.test(command);

/** The kind part of a B70 job's owner name, so b70q learns each kind's time and memory separately. */
export function b70Kind(command: string) {
  if (/minimax|\bh3\b|ref2va/i.test(command)) return "h3";
  if (/drama3|\btts\b|voice/i.test(command)) return "voice";
  if (/qwen|stills?\b|image/i.test(command)) return "stills";
  return "b70";
}

/** Starts `command` with bash in `cwd`; stdout and stderr go to the log. */
export async function startJob(
  storyFolder: string,
  slug: string,
  command: string,
  cwd: string,
  label: string,
  opts: { b70?: boolean; kind?: string } = {},
): Promise<Job> {
  const dir = join(storyFolder, ".director", "jobs");
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
  const tag = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "job";
  const log = join(dir, `${stamp}-${tag}.log`);
  const body = `echo "[dystory] started $(date -Is) in $PWD"; ( ${command} ); code=$?; echo "[dystory] exited $code at $(date -Is)"`;

  if (opts.b70) {
    const owner = `dystory-${slug.slice(0, 24)}-${opts.kind || "b70"}`.replace(/-+/g, "-");
    const env = Object.fromEntries(ENV_KEYS.flatMap((k) => (process.env[k] ? [[k, process.env[k]!]] : [])));
    const { id } = await b70q("POST", "/api/tickets", {
      owner,
      kind: "submit",
      argv: ["bash", "-c", `${body}; exit $code`],
      cwd,
      env,
      log,
      note: label,
      opts: { exit_file: `${log}.exit` },
    });
    return { unit: `${B70Q}${id}`, log, queue: await queueLine(`${B70Q}${id}`) };
  }

  const unit = `dystory-${slug.slice(0, 24)}-${stamp}-${tag}`.replace(/-+/g, "-");
  const script = `exec >> ${shellQuote(log)} 2>&1; ${body}; echo $code > ${shellQuote(`${log}.exit`)}`;
  const env = ENV_KEYS.flatMap((k) => (process.env[k] ? [`--setenv=${k}=${process.env[k]}`] : []));
  const res = await run([
    "systemd-run",
    "--user",
    "--quiet",
    "--collect",
    `--unit=${unit}`,
    `--working-directory=${cwd}`,
    ...env,
    "bash",
    "-c",
    script,
  ]);
  if (res.code !== 0) throw new Error(`Couldn't start the job: ${res.err || res.out}`);
  return { unit, log };
}

export async function unitActive(unit: string) {
  if (unit.startsWith(B70Q)) {
    const { ticket, series } = await b70q("GET", `/api/tickets/${unit.slice(B70Q.length)}`);
    // Retries and chunks are new tickets in the same series: the job runs while any of them does.
    if (series) return !!series.active;
    return ticket?.state === "waiting" || ticket?.state === "granted";
  }
  const res = await run(["systemctl", "--user", "is-active", unit]);
  return res.out === "active" || res.out === "activating" || res.out === "reloading";
}

export async function stopUnit(unit: string) {
  if (unit.startsWith(B70Q)) {
    // Kills it while it runs, cancels it while it waits (the current retry or chunk, if any).
    const first = unit.slice(B70Q.length);
    const { series } = await b70q("GET", `/api/tickets/${first}`).catch(() => ({ series: undefined }));
    const latest = series?.latest;
    const id = typeof latest === "number" ? latest : (latest?.id ?? first);
    await b70q("POST", `/api/tickets/${id}/kill`, {});
    return;
  }
  await run(["systemctl", "--user", "stop", unit]);
}

/** Where a waiting b70q job stands ("3rd in the B70 queue, starts about 22:40"); undefined once it runs. */
export async function queueLine(unit: string): Promise<string | undefined> {
  if (!unit.startsWith(B70Q)) return undefined;
  const first = Number(unit.slice(B70Q.length));
  // The job's current ticket: the first one, or its latest retry or chunk.
  const { series } = await b70q("GET", `/api/tickets/${first}`);
  const latest = series?.latest;
  const id = typeof latest === "number" ? latest : (latest?.id ?? first);
  const state = await b70q("GET", "/api/state");
  const entry = (state.queue ?? []).find((t: any) => t.id === id);
  if (!entry) return undefined;
  const at = entry.eta_start ? new Date(entry.eta_start).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : null;
  const ahead = entry.position - 1;
  return `Waiting for the B70: ${ahead === 0 ? "next in line" : `${ahead} job${ahead === 1 ? "" : "s"} ahead`}${at ? `, starts about ${at}` : ""}`;
}

/** How a finished job ended: its exit code and the end of its log. */
export async function jobReport(log: string, lines = 40) {
  let code: string | null = null;
  try {
    code = (await readFile(`${log}.exit`, "utf8")).trim();
  } catch {}
  let tail = "";
  try {
    const size = (await stat(log)).size;
    const text = await Bun.file(log).slice(Math.max(0, size - 64_000)).text();
    tail = text.split("\n").slice(-lines).join("\n");
  } catch {
    tail = "(no log)";
  }
  return { code, tail };
}
