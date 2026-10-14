/**
 * Bulk import a Cycle's investors and funding from a file or a Google
 * Sheet. Super admin and administrator (the import both adds people,
 * a preparer's job, and records funding, a finance job).
 *
 *   GET                         → the CSV template
 *   POST file / { sheet_url }   → preview: every row checked, nothing saved
 *   POST { action: "import", rows } → the rows are checked AGAIN here,
 *                                  then each ready row is imported
 *
 * Importing a row gives the person MaalRise access — a new login for
 * someone with none, created WITHOUT sending anything — and RECORDS
 * the funding. Confirming it is a separate press. A row whose bank
 * reference is already recorded in this Cycle is skipped, so importing
 * the same sheet twice adds nothing.
 */
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/server";
import { googleSheetsCsvUrl } from "@/lib/migration-parse";
import { MAALRISE_APPROVE_ROLES } from "@/lib/maalrise/permissions";
import { findLoginByEmail, isUuid, maalriseGate, readJson } from "@/lib/maalrise/api";
import { mr } from "@/lib/maalrise/db";
import { lagosToday } from "@/lib/maalrise/receipts";
import { addMaalriseInvestor } from "@/lib/maalrise/onboarding";
import {
  checkImportRows,
  importTemplateCsv,
  parseImportSheet,
  sanitizeImportRows,
  type ImportContext,
  type ImportRow,
  type PersonStatus,
} from "@/lib/maalrise/bulk-import";

const MAX_BYTES = 5 * 1024 * 1024;

export async function GET() {
  const gate = await maalriseGate(MAALRISE_APPROVE_ROLES);
  if (!gate.ok) return gate.response;
  return new NextResponse(importTemplateCsv(), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="maalrise-funding-import-template.csv"',
    },
  });
}

type Logins = Record<string, { id: string; name: string | null }>;

/** What the database already holds for these rows' Cycle and people. */
async function loadContext(db: SupabaseClient, cycleId: string, rows: ImportRow[]) {
  const { data: cycle, error } = await db.from("maalrise_cycles").select("id, status, unit_price_kobo").eq("id", cycleId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!cycle) return null;

  const [{ data: terms }, { data: fundings }] = await Promise.all([
    db.from("maalrise_cycle_terms").select("status, version, cost_kobo").eq("cycle_id", cycleId).in("status", ["approved", "submitted", "draft"]),
    db.from("maalrise_investor_fundings").select("units, reference, status").eq("cycle_id", cycleId).neq("status", "rejected"),
  ]);
  const t = [...(terms ?? [])].sort((a, b) => Number(b.status === "approved") - Number(a.status === "approved") || b.version - a.version)[0];
  const required = t ? Math.ceil(t.cost_kobo / cycle.unit_price_kobo) : Number.MAX_SAFE_INTEGER;
  // Refunded money is no longer in the Cycle; its reference stays used (061).
  const taken = (fundings ?? []).filter((f) => f.status !== "refunded").reduce((s, f) => s + f.units, 0);

  const emails = [...new Set(rows.map((r) => r.email).filter(Boolean))];
  const logins: Logins = {};
  const people: Record<string, PersonStatus> = {};
  for (let i = 0; i < emails.length; i += 20) {
    await Promise.all(emails.slice(i, i + 20).map(async (email) => {
      const { data: p, error: e } = await findLoginByEmail<{ email: string | null; id: string; role: string; full_name: string | null }>(
        db, email, "id, role, full_name");
      if (e) throw new Error(e.message);
      if (!p) people[email] = { kind: "new" };
      else if (p.role !== "investor") people[email] = { kind: "staff" };
      else { logins[email] = { id: p.id, name: p.full_name }; people[email] = { kind: "login", name: p.full_name }; }
    }));
  }
  const ids = Object.values(logins).map((l) => l.id);
  const maalrise: Record<string, string> = {};
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await db.from("maalrise_investors").select("id, profile_id, full_name").in("profile_id", ids.slice(i, i + 100));
    for (const m of data ?? []) maalrise[m.profile_id] = m.id;
    for (const [email, l] of Object.entries(logins)) {
      const m = (data ?? []).find((x) => x.profile_id === l.id);
      if (m) people[email] = { kind: "maalrise", name: m.full_name };
    }
  }

  const ctx: ImportContext = {
    today: lagosToday(),
    unitPriceKobo: cycle.unit_price_kobo,
    unitsAvailable: Math.max(0, required - taken),
    usedReferences: new Set((fundings ?? []).map((f) => String(f.reference).trim().toLowerCase())),
    people,
  };
  return { cycle, ctx, logins, maalrise };
}

/** An uploaded file, or null when the request is JSON. */
async function readUpload(request: Request): Promise<{ buffer: Buffer } | { error: string } | null> {
  if (!(request.headers.get("content-type") ?? "").includes("multipart/form-data")) return null;
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return { error: "Choose a file to upload." };
  if (file.size > MAX_BYTES) return { error: "The file is larger than 5 MB." };
  return { buffer: Buffer.from(await file.arrayBuffer()) };
}

/** A Google Sheet shared as "Anyone with the link can view", read as CSV. */
async function readGoogleSheet(link: string): Promise<{ buffer: Buffer } | { error: string }> {
  const urls = googleSheetsCsvUrl(link);
  if (urls === null) return { error: "That does not look like a Google Sheets link. Paste the address of the sheet (docs.google.com/spreadsheets/d/…)." };
  if (urls === "published_link") {
    return { error: "This is a “Publish to web” link, which cannot be read. Copy the address from the browser's address bar instead (it looks like docs.google.com/spreadsheets/d/…/edit)." };
  }
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    Accept: "text/csv,text/plain,*/*",
  };
  let status = 0;
  for (const url of [urls.primary, urls.fallback]) {
    try {
      const res = await fetch(url, { redirect: "follow", headers, cache: "no-store" });
      status = res.status;
      const body = await res.text();
      if (res.ok && !body.trimStart().startsWith("<")) {
        if (body.length > MAX_BYTES) return { error: "The sheet is larger than 5 MB." };
        return { buffer: Buffer.from(body, "utf8") };
      }
    } catch {
      // try the other address
    }
  }
  return {
    error: `Could not read the Google Sheet (HTTP ${status || "error"}). Set sharing to “Anyone with the link can view”, ` +
      "or download it as CSV (File → Download → CSV) and upload the file instead.",
  };
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await maalriseGate(MAALRISE_APPROVE_ROLES);
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Unknown Cycle." }, { status: 404 });

  // ---------------- Preview ----------------
  const upload = await readUpload(request);
  let rows: ImportRow[] | null = null;
  let importing = false;
  if (upload) {
    if (!("buffer" in upload)) return NextResponse.json({ error: upload.error }, { status: 400 });
    const parsed = parseImportSheet(upload.buffer);
    if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });
    rows = parsed.rows;
  } else {
    const b = await readJson<{ action?: string; sheet_url?: string; rows?: unknown }>(request);
    if (b?.action === "import") {
      rows = sanitizeImportRows(b.rows);
      if (!rows) return NextResponse.json({ error: "Nothing to import." }, { status: 400 });
      importing = true;
    } else {
      if (!b?.sheet_url?.trim()) return NextResponse.json({ error: "Paste a Google Sheets link or upload a file." }, { status: 400 });
      const sheet = await readGoogleSheet(b.sheet_url.trim());
      if (!("buffer" in sheet)) return NextResponse.json({ error: sheet.error }, { status: 400 });
      const parsed = parseImportSheet(sheet.buffer);
      if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });
      rows = parsed.rows;
    }
  }

  let loaded: Awaited<ReturnType<typeof loadContext>>;
  try {
    loaded = await loadContext(gate.db, id, rows);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not read the Cycle." }, { status: 400 });
  }
  if (!loaded) return NextResponse.json({ error: "Unknown Cycle." }, { status: 404 });
  if (!["draft", "terms_submitted", "terms_approved"].includes(loaded.cycle.status)) {
    return NextResponse.json({ error: "Funding can only be added before the Cycle is activated." }, { status: 400 });
  }
  const checked = checkImportRows(rows, loaded.ctx);
  if (!importing) return NextResponse.json(checked);

  // ---------------- Import (ready rows only, one at a time) ----------------
  const admin = mr(await createAdminClient());
  const results: { row: number; email: string; ok: boolean; skipped?: boolean; message: string }[] = [];
  const known: Record<string, string> = { ...loaded.maalrise };
  for (const r of checked.rows) {
    if (r.status === "already_imported") { results.push({ row: r.row, email: r.email, ok: true, skipped: true, message: "Already imported — skipped" }); continue; }
    if (r.status !== "ready") { results.push({ row: r.row, email: r.email, ok: false, message: r.issues.join("; ") }); continue; }
    try {
      const login = loaded.logins[r.email] ?? null;
      let investorId = login ? known[login.id] : undefined;
      let note = "Funding recorded";
      if (!investorId) {
        const added = await addMaalriseInvestor(gate.db, admin, gate.userId, login?.id ?? null, {
          email: r.email,
          fullName: r.full_name,
          loginName: login?.name,
          phone: r.phone || null,
          // Bank details come from the investor's KYC form, not the sheet.
          bankName: "",
          accountName: "",
          accountNumber: "",
        });
        investorId = added.id;
        if (login) known[login.id] = added.id;
        note = added.createdLogin ? "New login created (nothing sent) and funding recorded" : "Added to MaalRise and funding recorded";
      }
      const res = await gate.db.rpc("maalrise_record_funding", {
        p_cycle: id,
        p_investor: investorId,
        p_units: r.units,
        p_amount_kobo: r.amount_kobo,
        p_received_on: r.received_on,
        p_reference: r.reference,
      });
      if (res.error) throw new Error(res.error.message);
      results.push({ row: r.row, email: r.email, ok: true, message: note });
    } catch (e) {
      results.push({ row: r.row, email: r.email, ok: false, message: e instanceof Error ? e.message : "Could not import this row" });
    }
  }
  await gate.db.rpc("create_audit_log", {
    p_action: "maalrise_bulk_import", p_entity_type: "maalrise_cycle", p_entity_id: id, p_old_values: null,
    p_new_values: { rows: rows.length, imported: results.filter((x) => x.ok && !x.skipped).length,
                    skipped: results.filter((x) => x.skipped).length, failed: results.filter((x) => !x.ok).length },
  });
  return NextResponse.json({ results });
}

