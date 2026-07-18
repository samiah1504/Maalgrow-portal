import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import {
  parseSpreadsheet,
  googleSheetsCsvUrl,
  normalizeEmail,
  normalizePhone,
  type ParsedRow,
} from "@/lib/migration-parse";
import {
  requireSuperAdmin,
  loadExistingInvestorIndex,
} from "@/lib/migration-server";

// ─── GET: migration history ─────────────────────────────────────────
export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  const adminClient = await createAdminClient();
  const { data: batches } = await adminClient
    .from("migration_batches")
    .select(
      "*, series:series_id(name), cycle:cycle_id(cycle_label), uploader:uploaded_by(full_name, email)"
    )
    .order("created_at", { ascending: false })
    .limit(50);

  return NextResponse.json({ batches: batches ?? [] });
}

// ─── POST: create a batch from file upload or Google Sheets link ────
export async function POST(request: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    let seriesId: string | null = null;
    let cycleId: string | null = null;
    let source: string | null = null;
    let sourceName: string | null = null;
    let buffer: Buffer | null = null;

    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      seriesId = String(form.get("series_id") ?? "");
      cycleId = String(form.get("cycle_id") ?? "");
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
      }
      sourceName = file.name;
      source = /\.xlsx?$/i.test(file.name) ? "xlsx" : "csv";
      buffer = Buffer.from(await file.arrayBuffer());
    } else {
      const body = (await request.json()) as {
        series_id?: string;
        cycle_id?: string;
        sheet_url?: string;
      };
      seriesId = body.series_id ?? null;
      cycleId = body.cycle_id ?? null;
      const sheetUrl = body.sheet_url?.trim();
      if (!sheetUrl) {
        return NextResponse.json(
          { error: "Provide a Google Sheets link or upload a file" },
          { status: 400 }
        );
      }
      const csvUrl = googleSheetsCsvUrl(sheetUrl);
      if (!csvUrl) {
        return NextResponse.json(
          { error: "That does not look like a Google Sheets link. Paste the sheet's share URL (docs.google.com/spreadsheets/…)." },
          { status: 400 }
        );
      }
      source = "google_sheets";
      sourceName = sheetUrl;

      const res = await fetch(csvUrl, { redirect: "follow" });
      if (!res.ok) {
        return NextResponse.json(
          {
            error:
              "Could not read the Google Sheet. Make sure sharing is set to “Anyone with the link can view”, then try again.",
          },
          { status: 400 }
        );
      }
      const text = await res.text();
      if (text.trimStart().startsWith("<")) {
        return NextResponse.json(
          {
            error:
              "Google returned a sign-in page instead of the sheet. Set the sheet's sharing to “Anyone with the link can view” and try again.",
          },
          { status: 400 }
        );
      }
      buffer = Buffer.from(text, "utf8");
    }

    if (!seriesId || !cycleId) {
      return NextResponse.json(
        { error: "Select the Series and Cycle before importing" },
        { status: 400 }
      );
    }

    const adminClient = await createAdminClient();

    // Validate series + cycle pairing
    const { data: cycle } = await adminClient
      .from("cycles")
      .select("id, series_id, cycle_label, status")
      .eq("id", cycleId)
      .eq("series_id", seriesId)
      .single();
    if (!cycle) {
      return NextResponse.json(
        { error: "Cycle not found or does not belong to the selected series" },
        { status: 404 }
      );
    }

    // Parse + validate
    const { rows, errors } = parseSpreadsheet(buffer);
    if (errors.length > 0) {
      return NextResponse.json({ error: errors.join(" · ") }, { status: 400 });
    }

    // Duplicate detection: against existing investors and within the file
    const index = await loadExistingInvestorIndex(adminClient);
    const seenEmail = new Map<string, number>();
    const seenPhone = new Map<string, number>();

    type StagedRow = ParsedRow & {
      existing_investor_id: string | null;
      existing_label: string | null;
    };

    const staged: StagedRow[] = rows.map((row) => {
      let status = row.status;
      let issue = row.issue;
      let existingId: string | null = null;
      let existingLabel: string | null = null;

      const email = normalizeEmail(row.email);
      const phone = normalizePhone(row.phone);

      if (status === "valid") {
        // In-file duplicates
        const prevE = email ? seenEmail.get(email) : undefined;
        const prevP = phone ? seenPhone.get(phone) : undefined;
        if (prevE !== undefined || prevP !== undefined) {
          status = "invalid";
          issue = `Duplicate of row ${prevE ?? prevP} in this upload — merge or remove one of them`;
        } else {
          // Existing investor match
          const match =
            (email ? index.byEmail.get(email) : undefined) ??
            (phone ? index.byPhone.get(phone) : undefined);
          if (match) {
            status = "duplicate" as ParsedRow["status"];
            existingId = match.id;
            existingLabel = `${match.full_name} (${match.investor_code})`;
            issue = `Already exists as ${existingLabel} — choose “Add investment to existing investor” or skip`;
          }
        }
      }
      if (email) seenEmail.set(email, row.row_number);
      if (phone) seenPhone.set(phone, row.row_number);

      return { ...row, status: status as ParsedRow["status"], issue, existing_investor_id: existingId, existing_label: existingLabel };
    });

    // Create batch + rows
    const { data: batch, error: batchErr } = await adminClient
      .from("migration_batches")
      .insert({
        series_id: seriesId,
        cycle_id: cycleId,
        source: source!,
        source_name: sourceName,
        total_rows: staged.length,
        uploaded_by: auth.userId,
      })
      .select()
      .single();

    if (batchErr || !batch) {
      return NextResponse.json(
        { error: "Failed to create migration batch: " + batchErr?.message },
        { status: 500 }
      );
    }

    const { error: rowsErr } = await adminClient.from("migration_rows").insert(
      staged.map((r) => ({
        batch_id: batch.id,
        row_number: r.row_number,
        full_name: r.full_name,
        phone: r.phone,
        email: r.email,
        address: r.address,
        slots: r.slots,
        amount_paid: r.amount_paid,
        payment_date: r.payment_date,
        payment_reference: r.payment_reference,
        notes: r.notes,
        status: r.status,
        issue: r.issue,
        existing_investor_id: r.existing_investor_id,
      }))
    );

    if (rowsErr) {
      await adminClient.from("migration_batches").delete().eq("id", batch.id);
      return NextResponse.json(
        { error: "Failed to store rows: " + rowsErr.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ batch_id: batch.id }, { status: 201 });
  } catch (err) {
    console.error("[API] POST /admin/migration/batches error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
