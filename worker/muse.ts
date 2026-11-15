// Runs requests through Muse (Meta's coding agent) using the `muse login` on
// this machine. One `muse serve` process hosts every Muse session; the worker
// talks to it over stdio with Muse's JSON-RPC protocol (MSP; `muse schema
// generate-ts` prints it). Muse reaches the document tools over HTTP MCP,
// served here on 127.0.0.1 at a per-document URL.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { ConvexClient } from "convex/browser";
import type { Id } from "../convex/_generated/dataModel";
import { DOC_TOOLS, toolLabel } from "./doc-tools";

// Muse asks before every tool call; these are approved, anything else refused.
const ALLOWED_TOOLS = /^(mcp__doc__\w+|web_search|web_fetch)$/;
const REFUSAL = "That tool isn't available here. Use the document tools and web search/fetch.";

type Effort = "low" | "medium" | "high";
type Listener = (method: string, params: any) => void;

export type MuseRun = {
  docId: Id<"docs">;
  sessionId?: string;
  effort: Effort;
  text: string;
  signal: AbortSignal;
  onText: (text: string) => void;
  onActivity: (label: string) => void;
};

class Host {
  private proc: ReturnType<typeof Bun.spawn<"pipe", "pipe", "pipe">>;
  private nextId = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private listeners = new Map<string, Listener>();
  readonly exited: Promise<void>;

  constructor(cwd: string) {
    const model = process.env.MUSE_MODEL;
    this.proc = Bun.spawn(
      ["muse", "serve", "--disable-shell", "--disable-write", ...(model ? ["--model", model] : [])],
      { cwd, stdin: "pipe", stdout: "pipe", stderr: "pipe" },
    );
    this.exited = this.proc.exited.then((code) => {
      const err = new Error(`Muse stopped unexpectedly (exit code ${code}).`);
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
      for (const [sessionId, listener] of this.listeners) {
        listener("host/exited", { sessionId, message: err.message });
      }
    });
    this.readLines(this.proc.stdout, (line) => this.receive(line));
    this.readLines(this.proc.stderr, (line) => console.error(`[muse] ${line}`));
  }

  private async readLines(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void) {
    const decoder = new TextDecoder();
    let buf = "";
    for await (const chunk of stream) {
      buf += decoder.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) onLine(line);
      }
    }
  }

  private receive(line: string) {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      console.error(`[muse] unexpected output: ${line.slice(0, 200)}`);
      return;
    }
    if (msg.method) {
      // Server-initiated requests (approval/request) are answered through
      // approval/decide when the matching notification arrives.
      const sessionId = msg.params?.sessionId;
      if (msg.id == null && sessionId) this.listeners.get(sessionId)?.(msg.method, msg.params);
      return;
    }
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message ?? "Muse rejected the request."));
    else p.resolve(msg.result);
  }

  private send(msg: object) {
    this.proc.stdin.write(JSON.stringify(msg) + "\n");
    this.proc.stdin.flush();
  }

  call<T = any>(method: string, params: object): Promise<T> {
    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string, params: object) {
    this.send({ jsonrpc: "2.0", method, params });
  }

  listen(sessionId: string, listener: Listener) {
    this.listeners.set(sessionId, listener);
    return () => {
      if (this.listeners.get(sessionId) === listener) this.listeners.delete(sessionId);
    };
  }

  kill() {
    this.proc.kill();
  }
}

export function createMuse(convex: ConvexClient, workspace: string) {
  // The request each document is running; the worker runs one per document.
  const activeRequest = new Map<string, Id<"aiRequests">>();
  const secret = crypto.randomUUID();

  const mcp = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const [, prefix, key, docId] = new URL(req.url).pathname.split("/");
      if (prefix !== "mcp" || key !== secret || !docId) return new Response("Not found", { status: 404 });
      const server = new McpServer({ name: "doc", version: "1.0.0" });
      for (const t of DOC_TOOLS) {
        server.registerTool(t.name, { description: t.description, inputSchema: t.schema }, (args: any) => {
          const requestId = activeRequest.get(docId);
          if (!requestId) {
            return { content: [{ type: "text" as const, text: "No request is running for this document." }], isError: true };
          }
          return t.call({ convex, requestId, docId: docId as Id<"docs"> }, args);
        });
      }
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      await server.connect(transport);
      return transport.handleRequest(req);
    },
  });

  let host: Promise<Host> | null = null;
  const getHost = () => {
    host ??= (async () => {
      const h = new Host(workspace);
      h.exited.then(() => {
        host = null;
      });
      const init = await h.call("initialize", {
        clientInfo: { name: "dystory", version: "1.0.0" },
        capabilities: {
          requestedCapabilities: ["sessionMcp"],
          userInputDialogs: false,
          optOutNotificationMethods: ["session/tokenUsage", "session/contextUsage", "usage/changed"],
        },
      });
      if (!init.grantedCapabilities?.includes("sessionMcp")) {
        h.kill();
        throw new Error("This version of Muse can't give sessions their own tools (no sessionMcp).");
      }
      h.notify("initialized", {});
      return h;
    })().catch((err) => {
      host = null;
      throw err;
    });
    return host;
  };

  async function openSession(h: Host, docId: string, sessionId: string | undefined) {
    const config = {
      mcpServers: { doc: { transport: "streamableHttp", url: `http://127.0.0.1:${mcp.port}/mcp/${secret}/${docId}` } },
    };
    if (sessionId) {
      try {
        await h.call("session/resume", { commandId: Bun.randomUUIDv7(), sessionId, config, excludeItems: true });
        return sessionId;
      } catch (err) {
        // Its log may be gone; carry on as a fresh conversation.
        console.warn(`[muse] resume failed, starting fresh: ${(err as Error).message}`);
      }
    }
    const started = await h.call("session/start", { commandId: Bun.randomUUIDv7(), workspaceRoot: workspace, config });
    return started.session.sessionId as string;
  }

  /** Runs one request as a Muse turn. Resolves with the session to resume next time. */
  async function run(job: MuseRun & { requestId: Id<"aiRequests"> }) {
    const h = await getHost();
    activeRequest.set(job.docId, job.requestId);
    try {
      const sessionId = await openSession(h, job.docId, job.sessionId);
      const commandId = Bun.randomUUIDv7();
      const messages = new Map<string, string>(); // agent message itemId -> text, in order
      const emit = () =>
        job.onText([...messages.values()].map((t) => t.trim()).filter(Boolean).join("\n\n"));

      const error = await new Promise<string | undefined>((resolve, reject) => {
        const stop = h.listen(sessionId, (method, p) => {
          const item = p.item;
          if ((method === "item/started" || method === "item/completed") && item?.kind === "agentMessage") {
            messages.set(item.itemId, item.text ?? "");
            emit();
          } else if (method === "item/delta" && messages.has(p.itemId) && (p.field ?? "text") === "text") {
            messages.set(p.itemId, messages.get(p.itemId) + p.delta);
            emit();
          } else if (method === "item/started" && item?.kind === "toolCall") {
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(item.args ?? "{}");
            } catch {
              /* the activity line still names the tool */
            }
            job.onActivity(toolLabel(item.tool ?? "a tool", args));
          } else if (method === "approval/requested") {
            decide(h, sessionId, p).catch((err) => console.error(`[muse] approval failed: ${err.message}`));
          } else if (method === "turn/completed") {
            stop();
            if (p.terminal === "completed" || p.terminal === "cancelled") resolve(undefined);
            else if (p.error?.kind === "authRequired") resolve("Muse isn't logged in on this machine. Run `muse login`.");
            else resolve(p.error?.message ?? p.reason ?? `Muse stopped early (${p.terminal}).`);
          } else if (method === "host/exited") {
            stop();
            reject(new Error(p.message));
          }
        });
        const interrupt = () =>
          h.call("turn/interrupt", { commandId: Bun.randomUUIDv7(), sessionId }).catch(() => {});
        job.signal.addEventListener("abort", interrupt, { once: true });
        h.call("turn/start", {
          commandId,
          sessionId,
          reasoningEffort: job.effort,
          input: [{ type: "text", text: job.text }],
        }).then(
          () => job.signal.aborted && interrupt(),
          (err) => {
            stop();
            reject(err);
          },
        );
      });
      return { sessionId, error };
    } finally {
      if (activeRequest.get(job.docId) === job.requestId) activeRequest.delete(job.docId);
    }
  }

  async function decide(h: Host, sessionId: string, p: any) {
    const tool: string = p.subject?.toolName ?? p.toolName ?? "";
    const choices: any[] = p.availableChoices ?? [];
    const allow = ALLOWED_TOOLS.test(tool);
    const choice = allow
      ? choices.find((c) => c.decision === "approved")
      : choices.find((c) => c.decision === "abort" || c.decision === "denied");
    if (!choice) throw new Error(`no ${allow ? "allow" : "reject"} choice offered for ${tool}`);
    if (!allow) console.warn(`[muse] refused tool ${tool}`);
    await h.call("approval/decide", {
      commandId: Bun.randomUUIDv7(),
      sessionId,
      approvalId: p.approvalId,
      choiceId: choice.choiceId,
      requirementId: p.currentRequirementId,
      ...(!allow && choice.acceptsFeedback ? { feedback: REFUSAL } : {}),
    });
  }

  return { run };
}
