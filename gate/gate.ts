// Password gate in front of the app for public (Tailscale Funnel) visitors.
//
// Funnel sends the public to this port; it forwards everything, page loads
// and websockets alike, to the Vite server on 127.0.0.1:5190, which in turn
// proxies /api to Convex and /media to the media server. So this one gate guards the whole app.
//
// It's a lock on the front door, not accounts: one shared password in
// SITE_GATE_PASSWORD (.env.local). Visitors get a login page (login.html)
// once, then a 30-day cookie. Everything else without that cookie, including
// websocket upgrades, /api and /media, is refused with a bare 401.
//
// The tailnet and this machine are never asked: Tailscale names a tailnet
// person in Tailscale-User-Login (and strips any copy a public visitor sends),
// and a request made on this machine arrives on loopback with no
// X-Forwarded-For, which Tailscale always adds to what it forwards.
// Same scheme as ~/Work/book/dyclarity/src/server/site-gate.ts.
import { createServer, request as forward, type IncomingMessage, type ServerResponse } from "node:http";
import { connect } from "node:net";
import { readFileSync } from "node:fs";

const GATE_PORT = Number(process.env.GATE_PORT || 5192);
const TARGET_PORT = Number(process.env.PORT || 5190);
const TARGET_HOST = "127.0.0.1";
const PASSWORD = process.env.SITE_GATE_PASSWORD?.trim() ?? "";
const COOKIE = "dystory_gate";
const MAX_AGE = 30 * 24 * 60 * 60;
const LOGIN_PATH = "/__gate/login";
const LOGIN_PAGE = readFileSync(new URL("./login.html", import.meta.url), "utf8");

// Wrong-password lockout per visitor address: 10 tries per 15 minutes.
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 15 * 60_000;
const failures = new Map<string, { count: number; since: number }>();

const token = PASSWORD
  ? new Bun.CryptoHasher("sha256").update(`dystory-gate-v1:${PASSWORD}`).digest("hex")
  : "";

function header(req: IncomingMessage, name: string): string {
  const v = req.headers[name];
  return (Array.isArray(v) ? v.join(", ") : v)?.trim() ?? "";
}

function isLoopback(address: string | undefined) {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function needsGate(req: IncomingMessage): boolean {
  if (header(req, "tailscale-user-login")) return false; // someone on the tailnet
  if (isLoopback(req.socket.remoteAddress) && !header(req, "x-forwarded-for")) return false; // this machine
  return true;
}

function visitor(req: IncomingMessage): string {
  return header(req, "x-forwarded-for").split(",")[0]?.trim() || req.socket.remoteAddress || "?";
}

function safeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function hasCookie(req: IncomingMessage): boolean {
  for (const part of header(req, "cookie").split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === COOKIE) return safeEqual(rest.join("="), token);
  }
  return false;
}

function lockedOut(who: string): boolean {
  const f = failures.get(who);
  if (!f) return false;
  if (Date.now() - f.since > FAILURE_WINDOW_MS) {
    failures.delete(who);
    return false;
  }
  return f.count >= MAX_FAILURES;
}

function noteFailure(who: string) {
  const f = failures.get(who);
  if (!f || Date.now() - f.since > FAILURE_WINDOW_MS) failures.set(who, { count: 1, since: Date.now() });
  else f.count++;
}

function check(req: IncomingMessage): "ok" | "ask" | "closed" {
  if (!needsGate(req)) return "ok";
  if (!PASSWORD) return "closed";
  return hasCookie(req) ? "ok" : "ask";
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Where to send someone after they log in: only a path on this site. */
function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  return next.startsWith(LOGIN_PATH) ? "/" : next;
}

function loginPage(res: ServerResponse, status: number, next: string, error = "", locked = false) {
  const html = LOGIN_PAGE.replace("{{next}}", escapeHtml(next))
    .replace("{{error}}", error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : "")
    .replace("{{invalid}}", error && !locked ? 'aria-invalid="true"' : "")
    .replaceAll("{{disabled}}", locked ? "disabled" : "");
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    ...(locked ? { "Retry-After": "900" } : {}),
  });
  res.end(html);
}

const LOCKED = "Too many wrong tries. Try again in 15 minutes.";

async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 8192) break;
  }
  return new URLSearchParams(body);
}

async function logIn(req: IncomingMessage, res: ServerResponse) {
  const form = await readForm(req);
  const next = safeNext(form.get("next"));
  const who = visitor(req);
  if (lockedOut(who)) return loginPage(res, 429, next, LOCKED, true);
  if (!safeEqual(form.get("password")?.trim() ?? "", PASSWORD)) {
    noteFailure(who);
    return loginPage(res, 401, next, "That's not the password.");
  }
  failures.delete(who);
  res.writeHead(303, {
    Location: next,
    "Set-Cookie": `${COOKIE}=${token}; Max-Age=${MAX_AGE}; Path=/; HttpOnly; Secure; SameSite=Lax`,
    "Cache-Control": "no-store",
  });
  res.end();
}

const server = createServer((req, res) => {
  const verdict = check(req);
  if (verdict === "closed") {
    res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Video Review isn't open to the public: no SITE_GATE_PASSWORD is set.");
    return;
  }
  const path = req.url?.split("?")[0];
  if (path === LOGIN_PATH) {
    if (req.method === "POST" && verdict === "ask") return void logIn(req, res);
    res.writeHead(303, { Location: "/" });
    res.end();
    return;
  }
  if (verdict === "ask") {
    // Page loads get the login page; scripts, media and API calls get a plain refusal.
    if (req.method === "GET" && header(req, "accept").includes("text/html")) {
      const locked = lockedOut(visitor(req));
      return loginPage(res, locked ? 429 : 401, safeNext(req.url), locked ? LOCKED : "", locked);
    }
    res.writeHead(401, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    res.end("Video Review needs its password.");
    return;
  }

  const upstream = forward(
    { host: TARGET_HOST, port: TARGET_PORT, method: req.method, path: req.url, headers: req.headers },
    (response) => {
      res.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(res);
    },
  );
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Video Review isn't running. Start it with `bun run start`.");
  });
  req.pipe(upstream);
});

// Live sync (Convex) and Vite's reload channel are websockets.
server.on("upgrade", (req, socket, head) => {
  const verdict = check(req);
  if (verdict !== "ok") {
    socket.end("HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
    return;
  }
  const upstream = connect(TARGET_PORT, TARGET_HOST, () => {
    const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
    if (head.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  const close = () => {
    upstream.destroy();
    socket.destroy();
  };
  for (const side of [upstream, socket]) {
    side.on("error", close);
    side.on("close", close);
  }
});

server.listen(GATE_PORT, "127.0.0.1", () => {
  console.log(
    PASSWORD
      ? `[gate] 127.0.0.1:${GATE_PORT} -> ${TARGET_HOST}:${TARGET_PORT}; public visitors need the password`
      : `[gate] 127.0.0.1:${GATE_PORT}: no SITE_GATE_PASSWORD set, so public visitors are turned away`,
  );
});
