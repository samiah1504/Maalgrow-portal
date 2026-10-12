import crypto from "node:crypto";
export const SECRET = "local-e2e-only-secret-local-e2e-only-secret-0123";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
export function sign(payload) {
  const h = b64({ alg: "HS256", typ: "JWT" }), p = b64({ iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000) + 86400, ...payload });
  return `${h}.${p}.${crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url")}`;
}
export function verify(token) {
  const [h, p, s] = token.split(".");
  const ok = crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url") === s;
  return ok ? JSON.parse(Buffer.from(p, "base64url").toString()) : null;
}
