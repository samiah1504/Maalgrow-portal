/**
 * HTML to PDF, through headless Chrome.
 *
 * Deliberately has no idea what a settlement is. It takes a string of
 * HTML and gives back bytes, so the same function serves the download
 * route, the settlement follow-on job and the step 7 email — one
 * renderer, so the file an investor downloads and the file attached to
 * their email cannot be two different documents.
 *
 * SERVER ONLY. Never import this into a client component.
 */

import type { Browser } from "puppeteer-core";
import { inlineReportFonts } from "./report-assets";

/**
 * Where Chrome lives.
 *
 * On Vercel there is no browser on the box, so @sparticuz/chromium
 * unpacks one built for Lambda. Locally — and in CI — a real Chrome or
 * Chromium is already installed and unpacking a second copy would be
 * slow and pointless. CHROME_PATH wins over both, for the cases
 * neither guess covers.
 */
const LOCAL_CANDIDATES = [
  "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

async function launch(): Promise<Browser> {
  const puppeteer = await import("puppeteer-core");

  if (process.env.CHROME_PATH) {
    return puppeteer.launch({
      executablePath: process.env.CHROME_PATH,
      args: ["--no-sandbox", "--disable-gpu"],
      headless: true,
    });
  }

  // Serverless: no browser on the machine
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const chromium = (await import("@sparticuz/chromium")).default;
    return puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }

  const { existsSync } = await import("node:fs");
  const found = LOCAL_CANDIDATES.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      "No Chrome or Chromium found for PDF rendering. Set CHROME_PATH to a browser executable."
    );
  }
  return puppeteer.launch({
    executablePath: found,
    args: ["--no-sandbox", "--disable-gpu"],
    headless: true,
  });
}

export type PdfOptions = {
  /** Fonts are inlined by default; a caller serving over HTTP may not need it */
  inlineFonts?: boolean;
  timeoutMs?: number;
};

/**
 * A browser held open across several documents.
 *
 * WHY THIS EXISTS. Starting Chrome is by far the most expensive part of
 * rendering a statement — on a serverless box it unpacks a compressed
 * binary and cold-starts an entire browser, and that cost has nothing
 * to do with how long the page takes to draw. Paying it once per
 * document meant a batch of five spent most of its time starting and
 * stopping the same program five times. A fresh PAGE per document is
 * kept, because that is cheap and it is what stops one document's
 * state reaching the next; the browser is what gets reused.
 *
 * Always closed in a `finally`. A browser left running holds the
 * function open and the platform kills it with no error recorded.
 */
export type PdfRenderer = {
  render(html: string, opts?: PdfOptions): Promise<Buffer>;
  close(): Promise<void>;
};

export async function openPdfRenderer(): Promise<PdfRenderer> {
  const browser = await launch();
  return {
    async render(html: string, opts: PdfOptions = {}) {
      return renderOn(browser, html, opts);
    },
    async close() {
      await browser.close().catch(() => {});
    },
  };
}

/**
 * Render a complete HTML document to an A4 PDF.
 *
 * Two settings here are not preferences:
 *
 *   printBackground — without it every coloured band prints white. The
 *   masthead, the profit bar, the charts and the ring all disappear and
 *   the document arrives looking broken.
 *
 *   document.fonts.ready — without waiting, Chrome may capture before
 *   the faces load, and the whole document reflows against a fallback.
 *   Every line break moves.
 */
async function renderOn(
  browser: Browser,
  html: string,
  opts: PdfOptions = {}
): Promise<Buffer> {
  const { inlineFonts = true, timeoutMs = 30_000 } = opts;

  // Embedded fonts mean the page needs nothing from the network, so it
  // renders identically on a laptop and on a cold Lambda.
  const source = inlineFonts ? inlineReportFonts(html).html : html;

  const page = await browser.newPage();
  try {
    await page.setContent(source, {
      waitUntil: "load",
      timeout: timeoutMs,
    });
    await page.evaluateHandle("document.fonts.ready");

    const bytes = await page.pdf({
      format: "A4",
      printBackground: true,
      // The document sets its own 11mm margins; a second set here
      // would shrink the page inside them.
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
      preferCSSPageSize: true,
      timeout: timeoutMs,
    });
    return Buffer.from(bytes);
  } finally {
    // Not closing the page leaks a renderer process per document, and
    // a batch of thirty-eight exhausts the box's memory long before it
    // exhausts the list.
    await page.close().catch(() => {});
  }
}

/** One document, one browser. For callers rendering a single file. */
export async function htmlToPdf(
  html: string,
  opts: PdfOptions = {}
): Promise<Buffer> {
  const renderer = await openPdfRenderer();
  try {
    return await renderer.render(html, opts);
  } finally {
    await renderer.close();
  }
}

/**
 * "MaalGrow-Series-A-Feb-2026-Apr-2026-Statement.pdf"
 *
 * It has to be recognisable in a downloads folder and in a WhatsApp
 * thread months later, so the series and the cycle both appear.
 */
export function statementFilename(
  seriesName: string,
  cycleLabel: string,
  kind: "Statement" | "Credit-Note" = "Statement"
): string {
  const slug = (s: string) =>
    String(s ?? "")
      .replace(/[^\w\s-]/g, " ")
      .trim()
      .replace(/\s+/g, "-");
  return `MaalGrow-Series-${slug(seriesName)}-${slug(cycleLabel)}-${kind}.pdf`;
}

/** Where the file lives in the bucket. Never handed to a browser. */
export function statementStoragePath(
  cycleId: string,
  investmentId: string,
  kind: "statement" | "credit_note" = "statement"
): string {
  return `${cycleId}/${kind}-${investmentId}.pdf`;
}
