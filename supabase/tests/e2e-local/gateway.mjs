// LOCAL gateway imitating Supabase's URL layout: /rest/v1 → PostgREST, /auth/v1/user → token check,
// /auth/v1/admin (create a login, never emails), and Resend's POST /emails (recorded to a file, never sent).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { verify } from "./jwt.mjs";
const DB = process.env.E2E_DB || "mr_e2e";
const SENT = process.env.E2E_SENT || "";
const readBody = (req) => new Promise((r) => { const ch = []; req.on("data", (d) => ch.push(d)); req.on("end", () => r(Buffer.concat(ch))); });
const STORAGE = process.env.E2E_STORAGE || "";
const PGRST = "http://127.0.0.1:3001";
const EMAILS = JSON.parse(process.env.E2E_EMAILS || "{}");
http.createServer(async (req, res) => {
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS" };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  const url = new URL(req.url, "http://x");
  const bearer = (req.headers.authorization || "").replace(/^Bearer /, "");
  if (url.pathname === "/auth/v1/user") {
    const c = bearer && verify(bearer);
    if (!c || !c.sub) { res.writeHead(401, { ...cors, "Content-Type": "application/json" }); return res.end('{"message":"invalid"}'); }
    res.writeHead(200, { ...cors, "Content-Type": "application/json" });
    const email = EMAILS[c.sub] || c.email || "";
    return res.end(JSON.stringify({ id: c.sub, aud: "authenticated", role: "authenticated", email, app_metadata: {}, user_metadata: {} }));
  }
  const send = (code, o) => { res.writeHead(code, { ...cors, "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
  // GoTrue admin, imitated: a login is created (or found) and a link returned. Nothing is emailed.
  if (url.pathname === "/auth/v1/admin/generate_link" && req.method === "POST") {
    if (verify(bearer)?.role !== "service_role") return send(403, { msg: "service role required" });
    const b = JSON.parse((await readBody(req)).toString() || "{}");
    const email = String(b.email || "").toLowerCase();
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) return send(422, { msg: "bad email" });
    let id = execFileSync("psql", ["-d", DB, "-Atq", "-c", `select id from auth.users where lower(email) = '${email.replace(/'/g, "''")}'`], { encoding: "utf8" }).trim();
    if (!id) {
      id = crypto.randomUUID();
      execFileSync("psql", ["-d", DB, "-Atq", "-c", `insert into auth.users (id, email) values ('${id}', '${email.replace(/'/g, "''")}')`]);
    }
    EMAILS[id] = email;
    return send(200, { id, email, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: b.data || {},
      action_link: "http://localhost:3000/never-used", hashed_token: crypto.randomBytes(16).toString("hex"),
      verification_type: b.type || "invite", redirect_to: b.redirect_to || "" });
  }
  const delUser = url.pathname.match(/^\/auth\/v1\/admin\/users\/([0-9a-f-]{36})$/);
  if (delUser && req.method === "DELETE") {
    if (verify(bearer)?.role !== "service_role") return send(403, { msg: "service role required" });
    execFileSync("psql", ["-d", DB, "-Atq", "-c", `delete from auth.users where id = '${delUser[1]}'`]);
    return send(200, {});
  }
  // Resend, imitated: the email is written to a file, never sent. An address containing "bounce" is refused.
  if (url.pathname === "/emails" && req.method === "POST") {
    const b = JSON.parse((await readBody(req)).toString() || "{}");
    const to = [].concat(b.to || []).join(",");
    if (/bounce/.test(to)) return send(422, { name: "validation_error", message: `Recipient ${to} rejected`, statusCode: 422 });
    const id = crypto.randomUUID();
    if (SENT) fs.appendFileSync(SENT, JSON.stringify({ id, to, subject: b.subject, html: b.html, from: b.from }) + "\n");
    return send(200, { id });
  }
  // Supabase Storage, imitated on disk: only the service role may write
  // or sign; a signed link serves the file.
  if (url.pathname.startsWith("/storage/v1/object") && STORAGE) {
    const json = (code, o) => { res.writeHead(code, { ...cors, "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
    const body = await new Promise((r) => { const ch = []; req.on("data", (d) => ch.push(d)); req.on("end", () => r(Buffer.concat(ch))); });
    const claims = bearer ? verify(bearer) : null;
    const service = claims?.role === "service_role";
    const safe = (p) => { const f = path.resolve(STORAGE, p); if (!f.startsWith(STORAGE + path.sep)) throw new Error("bad path"); return f; };
    const signMatch = url.pathname.match(/^\/storage\/v1\/object\/sign\/(.+)$/);
    if (signMatch && req.method === "GET") {
      const key = decodeURIComponent(signMatch[1]);
      const expect = crypto.createHmac("sha256", "e2e-sign").update(key).digest("hex");
      if (url.searchParams.get("token") !== expect || !fs.existsSync(safe(key))) return json(400, { error: "invalid signature" });
      res.writeHead(200, { ...cors, "Content-Type": "application/octet-stream" });
      return res.end(fs.readFileSync(safe(key)));
    }
    if (!service) return json(403, { statusCode: "403", error: "Unauthorized", message: "service role required" });
    if (signMatch && req.method === "POST") {
      const key = decodeURIComponent(signMatch[1]);
      if (!fs.existsSync(safe(key))) return json(404, { statusCode: "404", error: "not_found", message: "Object not found" });
      const token = crypto.createHmac("sha256", "e2e-sign").update(key).digest("hex");
      return json(200, { signedURL: `/object/sign/${signMatch[1]}?token=${token}` });
    }
    const objMatch = url.pathname.match(/^\/storage\/v1\/object\/(.+)$/);
    if (objMatch && req.method === "POST") {
      const key = decodeURIComponent(objMatch[1]);
      if (fs.existsSync(safe(key))) return json(409, { statusCode: "409", error: "Duplicate", message: "The resource already exists" });
      fs.mkdirSync(path.dirname(safe(key)), { recursive: true });
      fs.writeFileSync(safe(key), body);
      return json(200, { Key: key, Id: crypto.randomUUID() });
    }
    if (objMatch && req.method === "DELETE") {
      const bucket = decodeURIComponent(objMatch[1]);
      const { prefixes = [] } = JSON.parse(body.toString() || "{}");
      for (const p of prefixes) { try { fs.unlinkSync(safe(`${bucket}/${p}`)); } catch {} }
      return json(200, prefixes.map((name) => ({ name })));
    }
    return json(400, { error: "unsupported storage call" });
  }
  if (url.pathname.startsWith("/rest/v1")) {
    const body = await new Promise((r) => { const ch = []; req.on("data", (d) => ch.push(d)); req.on("end", () => r(Buffer.concat(ch))); });
    const headers = { ...req.headers }; delete headers.host; delete headers["content-length"];
    if (!headers.authorization && headers.apikey) headers.authorization = `Bearer ${headers.apikey}`;
    const r = await fetch(PGRST + url.pathname.replace("/rest/v1", "") + url.search, { method: req.method, headers, body: ["GET","HEAD"].includes(req.method) ? undefined : body });
    const out = Buffer.from(await r.arrayBuffer());
    const h = { ...cors }; r.headers.forEach((v, k) => { if (!["content-encoding","transfer-encoding","connection"].includes(k) && !k.startsWith("access-control-")) h[k] = v; });
    res.writeHead(r.status, h); return res.end(out);
  }
  res.writeHead(404, cors); res.end();
}).listen(54321, "127.0.0.1", () => console.log("gateway on 54321"));
