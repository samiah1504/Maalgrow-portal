/**
 * No function in the database may carry an unfiltered UPDATE or DELETE.
 *
 * Not a style rule. Supabase runs the safeupdate guard, which refuses
 * any UPDATE or DELETE without a WHERE — inside functions too, and on
 * temp tables too. Plain Postgres does not, so the entire scenario
 * suite passes locally while settlement fails on the real database.
 * That is the worst place for a difference to live.
 *
 * It cost two rounds to find, because the first sweep looked for
 * DELETEs, fixed one, and declared the schema clean while the very
 * next statement over the same temp table was an unfiltered UPDATE.
 *
 * CHECKED AGAINST THE DATABASE, NOT THE FILES. A migration that is
 * later superseded still contains its old text for ever; only the
 * final definition of each function can actually run. Scanning files
 * flags history and proves nothing about what would execute.
 *
 *   createdb scratch && <apply migrations>
 *   npx tsx scripts/check-unfiltered-writes.ts scratch
 */
import { execFileSync } from "node:child_process";

const db = process.argv[2] ?? process.env.PGDATABASE;
if (!db) {
  console.error("usage: tsx scripts/check-unfiltered-writes.ts <database>");
  process.exit(2);
}

/** Unlikely in SQL, and keeps the name and the body unambiguously apart. */
const SEP = "@@--@@";

const out = execFileSync(
  "psql",
  [
    "-d", db, "-At", "-c",
    `SELECT proname || '${SEP}' || prosrc
       FROM pg_proc
      WHERE pronamespace = 'public'::regnamespace
      ORDER BY proname`,
  ],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
);

const bad: string[] = [];

for (const row of out.split(new RegExp(`\\n(?=[a-z_0-9]+@@--@@)`))) {
  const at = row.indexOf(SEP);
  if (at < 0) continue;
  const name = row.slice(0, at);
  const lines = row.slice(at + SEP.length).split("\n");

  for (let i = 0; i < lines.length; i++) {
    const st = lines[i].trim();
    if (st.startsWith("--")) continue;
    const m = /^(UPDATE|DELETE\s+FROM)\s+([A-Za-z_][\w.]*)/i.exec(st);
    if (!m) continue;

    // Read to the terminating semicolon, tracking parens, so a WHERE
    // several lines further down still counts.
    let depth = 0;
    const buf: string[] = [];
    let j = i;
    for (; j < lines.length; j++) {
      const code = lines[j].replace(/--.*$/, "");
      depth += (code.match(/\(/g) ?? []).length - (code.match(/\)/g) ?? []).length;
      buf.push(code);
      if (depth <= 0 && code.trimEnd().endsWith(";")) break;
    }
    if (!/\bWHERE\b/i.test(buf.join(" "))) {
      bad.push(`${name}()  ${m[1].toUpperCase()} ${m[2]} — ${st.slice(0, 60)}`);
    }
    i = j;
  }
}

if (bad.length) {
  console.error(`FAIL: ${bad.length} unfiltered write(s). Supabase will refuse these:\n`);
  for (const b of bad) console.error("  " + b);
  console.error("\nTRUNCATE empties a table; WHERE TRUE says every row is meant.");
  process.exit(1);
}
console.log("PASS: no function carries an unfiltered UPDATE or DELETE");
