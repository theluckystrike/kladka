// Kładka local web server. Node 22, standard library only.
// Binds to 127.0.0.1. Serves the static UI and a small JSON API.
// Drafts are held in memory for the length of one request and never logged.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { coach, rulesOnly, modelHealth } from "./src/pipeline.mjs";
import { TASKS, TARGETS } from "./src/tasks.mjs";
import { RULES } from "./src/rules.mjs";
import { record, readCounts } from "./src/counts.mjs";

const HOST = "127.0.0.1";
const PORT = Number(process.env.KLADKA_PORT || 8787);
const PUBLIC = join(fileURLToPath(new URL(".", import.meta.url)), "public");
const MAX_BODY = 32 * 1024;
const IDLE_MINUTES = Number(process.env.KLADKA_IDLE_MINUTES || 15);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" };
const SECURITY_HEADERS = {
  "content-security-policy": "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
};

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "content-type": type, ...SECURITY_HEADERS });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw new RangeError("request too large");
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${HOST}`);
  // Reject requests that did not come to a loopback host name (DNS rebinding guard).
  const hostHeader = (req.headers.host || "").replace(/:\d+$/, "");
  if (!["127.0.0.1", "localhost"].includes(hostHeader)) return send(res, 403, { error: "forbidden host" });

  if (req.method === "GET" && url.pathname === "/api/health") {
    return send(res, 200, { ok: true, model: await modelHealth(), rules: RULES.length });
  }
  if (req.method === "GET" && url.pathname === "/api/tasks") {
    return send(res, 200, { tasks: TASKS, targets: TARGETS, idleMinutes: IDLE_MINUTES });
  }
  if (req.method === "GET" && url.pathname === "/api/counts") {
    return send(res, 200, readCounts());
  }
  if (req.method === "POST" && url.pathname === "/api/new-person") {
    record({ type: "new_person" });
    return send(res, 200, { ok: true });
  }
  if (req.method === "POST" && (url.pathname === "/api/rules" || url.pathname === "/api/coach")) {
    let input;
    try {
      input = await readJson(req);
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
    try {
      if (url.pathname === "/api/rules") return send(res, 200, { rules: rulesOnly(input) });
      const out = await coach(input);
      record({ type: "check", task: input.task, target: input.target });
      return send(res, 200, out);
    } catch (e) {
      return send(res, e instanceof RangeError ? 400 : 500, { error: e.message });
    }
  }
  if (req.method === "GET") {
    const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const file = normalize(join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC)) return send(res, 403, { error: "forbidden" });
    try {
      return send(res, 200, await readFile(file), TYPES[extname(file)] || "application/octet-stream");
    } catch {
      return send(res, 404, { error: "not found" });
    }
  }
  return send(res, 405, { error: "method not allowed" });
}

createServer((req, res) => {
  handle(req, res).catch(() => send(res, 500, { error: "internal error" }));
}).listen(PORT, HOST, () => {
  console.log(`Kladka is running at http://${HOST}:${PORT} (local only)`);
});
