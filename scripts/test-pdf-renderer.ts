/**
 * The renderer that holds one browser open across a batch.
 *
 * WHY THIS IS TESTED. Building a cycle's statements started Chrome
 * once per document. Starting the browser costs far more than drawing
 * the page — on the deployed box it unpacks a compressed binary and
 * cold-starts an entire program — so a batch of five spent most of its
 * time launching and killing the same thing five times.
 *
 * The awkward part of testing "it reuses the browser" is that a
 * version which did NOT reuse it would still produce correct PDFs.
 * The assertion that separates them is the last one: after close(),
 * rendering must FAIL. If every render made its own browser, closing
 * would leave the next one perfectly able to work.
 *
 *   npx tsx scripts/test-pdf-renderer.ts
 */
import { openPdfRenderer, htmlToPdf } from "../src/lib/mudarabah/pdf";
import {
  inlineReportFonts,
  clearFontCache,
} from "../src/lib/mudarabah/report-assets";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log("PASS:", name);
  else {
    failures++;
    console.error("FAIL:", name, detail ?? "");
  }
}

const doc = (title: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><style>
     @page { size: A4; margin: 11mm; }
     body { font-family: sans-serif; }
   </style></head><body><h1>${title}</h1></body></html>`;

const isPdf = (b: Buffer) => b.subarray(0, 5).toString() === "%PDF-";

async function main() {
  /* ── One browser, several documents ────────────────────────── */

  const renderer = await openPdfRenderer();

  const first = await renderer.render(doc("One"));
  const second = await renderer.render(doc("Two"));
  const third = await renderer.render(doc("Three"));

  check("the first document renders", isPdf(first), first.subarray(0, 8));
  check("so does the second, on the same browser", isPdf(second));
  check("and the third", isPdf(third));
  // Different content must give different bytes — a reused browser
  // must not be handing back the first page over and over.
  check(
    "each document is its own document",
    !first.equals(second) && !second.equals(third)
  );

  await renderer.close();

  // THE ONE THAT PROVES REUSE. A renderer that launched per render
  // would be unaffected by close().
  let refusedAfterClose = false;
  try {
    await renderer.render(doc("After close"));
  } catch {
    refusedAfterClose = true;
  }
  check(
    "after close() the renderer is spent — the browser was shared, not per-document",
    refusedAfterClose
  );

  // Closing twice must not throw: generateStatements closes in a
  // `finally`, and a throw there would mask the real error.
  let doubleCloseThrew = false;
  try {
    await renderer.close();
  } catch {
    doubleCloseThrew = true;
  }
  check("closing twice is harmless", !doubleCloseThrew);

  /* ── The single-shot wrapper still works ───────────────────── */

  const single = await htmlToPdf(doc("Alone"));
  check("htmlToPdf still renders one document on its own", isPdf(single));

  /* ── Fonts are read once, but reported every time ──────────── */

  const dir = mkdtempSync(join(tmpdir(), "fonts-"));
  writeFileSync(join(dir, "Test-Regular.woff2"), Buffer.from("not-a-real-font"));
  clearFontCache();

  const css = `@font-face { src: url('/fonts/Test-Regular.woff2'); }`;
  const a = inlineReportFonts(css, dir);
  const b = inlineReportFonts(css, dir);

  check("the face is embedded", a.html.includes("data:font/woff2;base64,"));
  check("the second document gets the same bytes", a.html === b.html);
  // The cache is an optimisation, not a change of contract: a caller
  // asking "is my document self-contained?" must get the same answer
  // on the thirty-eighth document as on the first.
  check(
    "and is still reported as inlined on the second call",
    b.inlined.length === 1 && b.inlined[0] === "Test-Regular.woff2",
    b
  );

  const missing = inlineReportFonts(
    `@font-face { src: url('/fonts/Absent.woff2'); }`,
    dir
  );
  check(
    "a face that is not there is reported missing, not silently dropped",
    missing.missing.length === 1 && missing.html.includes("/fonts/Absent.woff2")
  );
  const missingAgain = inlineReportFonts(
    `@font-face { src: url('/fonts/Absent.woff2'); }`,
    dir
  );
  check(
    "and stays reported missing on every later document",
    missingAgain.missing.length === 1,
    missingAgain
  );

  rmSync(dir, { recursive: true, force: true });
  clearFontCache();

  console.log(failures === 0 ? "\nAll passed" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
