// LOCAL gateway imitating Supabase's URL layout: /rest/v1 → PostgREST, /auth/v1/user → token check.
import http from "node:http";
import { verify } from "./jwt.mjs";
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
    return res.end(JSON.stringify({ id: c.sub, aud: "authenticated", role: "authenticated", email: EMAILS[c.sub] || "", app_metadata: {}, user_metadata: {} }));
  }
  if (url.pathname.startsWith("/rest/v1")) {
    const body = await new Promise((r) => { const ch = []; req.on("data", (d) => ch.push(d)); req.on("end", () => r(Buffer.concat(ch))); });
    const headers = { ...req.headers }; delete headers.host; delete headers["content-length"];
    if (!headers.authorization && headers.apikey) headers.authorization = `Bearer ${headers.apikey}`;
    const r = await fetch(PGRST + url.pathname.replace("/rest/v1", "") + url.search, { method: req.method, headers, body: ["GET","HEAD"].includes(req.method) ? undefined : body });
    const out = Buffer.from(await r.arrayBuffer());
    const h = { ...cors }; r.headers.forEach((v, k) => { if (!["content-encoding","transfer-encoding","connection"].includes(k)) h[k] = v; });
    res.writeHead(r.status, h); return res.end(out);
  }
  res.writeHead(404, cors); res.end();
}).listen(54321, "127.0.0.1", () => console.log("gateway on 54321"));
