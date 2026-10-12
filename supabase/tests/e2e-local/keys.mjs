import { sign } from "./jwt.mjs";
console.log(`ANON=${sign({ role: "anon" })}`);
console.log(`SERVICE=${sign({ role: "service_role" })}`);
