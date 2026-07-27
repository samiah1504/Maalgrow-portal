/**
 * Making a report document stand on its own.
 *
 * The stylesheet points at /fonts/*.woff2, which is right when Next is
 * serving the page. It is wrong everywhere else: a file saved to disk
 * and opened, an HTML email, or a headless browser given a file:// URL
 * all resolve /fonts against the wrong root and quietly fall back to a
 * system typeface. The document still renders — which is the problem,
 * because nobody notices until the printed statement looks nothing like
 * the preview.
 *
 * Inlining the faces as data URIs removes the dependency entirely. The
 * step 7 email job will want exactly this.
 *
 * SERVER ONLY — it reads from the filesystem.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const FONT_URL = /url\('\/fonts\/([^']+\.woff2)'\)/g;

export type InlineResult = {
  html: string;
  /** Faces successfully embedded */
  inlined: string[];
  /**
   * Faces that could not be found. NOT thrown: a document with one
   * missing face is still worth sending, and the caller is better
   * placed to decide. But it must be visible, never silent.
   */
  missing: string[];
};

export function defaultFontDir(): string {
  return join(process.cwd(), "public", "fonts");
}

/**
 * Rewrite every /fonts/*.woff2 reference into an embedded data URI.
 * Each file is read once however many times it is referenced.
 */
export function inlineReportFonts(
  html: string,
  fontDir: string = defaultFontDir()
): InlineResult {
  const cache = new Map<string, string | null>();
  const inlined: string[] = [];
  const missing: string[] = [];

  const out = html.replace(FONT_URL, (whole, file: string) => {
    if (!cache.has(file)) {
      const path = join(fontDir, file);
      if (existsSync(path)) {
        cache.set(file, readFileSync(path).toString("base64"));
        inlined.push(file);
      } else {
        cache.set(file, null);
        missing.push(file);
      }
    }
    const b64 = cache.get(file);
    return b64 ? `url('data:font/woff2;base64,${b64}')` : whole;
  });

  return { html: out, inlined, missing };
}
