import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireSuperAdmin } from "@/lib/migration-server";
import { generateUniqueInvestorCode } from "@/lib/investor-code";
import { calcCapital, getPaymentStatus, SLOT_VALUE_NGN } from "@/lib/investment-utils";
import { sendOnboardingEmail } from "@/lib/email";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";
import { SITE_URL } from "@/lib/site-url";

type AdminClient = SupabaseClient<Database>;

// Cycles in these states are historical: imported investments are
// recorded as completed and are NOT auto-activated.
const HISTORICAL_CYCLE_STATUSES = [
  "completed",
  "matured",
  "awaiting_profit_declaration",
  "cancelled",
];

const CHUNK_DEFAULT = 20;

type BatchCtx = {
  batchId: string;
  userId: string;
  emailMode: string;
  series: { id: string; name: string };
  cycle: {
    id: string;
    cycle_number: number;
    cycle_label: string;
    start_date: string;
    end_date: string;
    status: string;
  };
  siteUrl: string;
};

type MigrationRow = Database["public"]["Tables"]["migration_rows"]["Row"];

/**
 * Processes ONE row idempotently. Progress (investor_id, investment_id)
 * is persisted after each step, so a retry after a crash resumes from
 * the exact step that was missing instead of duplicating anything.
 */
async function processRow(
  adminClient: AdminClient,
  ctx: BatchCtx,
  row: MigrationRow
): Promise<{ ok: boolean; error?: string }> {
  const save = async (fields: Partial<MigrationRow>) => {
    await adminClient
      .from("migration_rows")
      .update(fields as never)
      .eq("id", row.id);
    Object.assign(row, fields);
  };

  try {
    const slots = Number(row.slots);
    const capital = calcCapital(slots);
    const email = row.email!;
    let isNewInvestor = false;

    // ── Step 1: resolve or create the investor ──
    let investorId = row.investor_id;
    let investorCode: string | null = null;
    let investorProfileId: string | null = null;

    if (!investorId && row.action === "attach" && row.existing_investor_id) {
      investorId = row.existing_investor_id;
    }

    if (investorId) {
      const { data: inv } = await adminClient
        .from("investors")
        .select("id, investor_code, profile_id, full_name, email")
        .eq("id", investorId)
        .single();
      if (!inv) throw new Error("Linked investor no longer exists");
      investorCode = inv.investor_code;
      investorProfileId = inv.profile_id;
    } else {
      // Resume safety: if a previous partial run already created this
      // investor, reuse it rather than failing on the unique email.
      const { data: existing } = await adminClient
        .from("investors")
        .select("id, investor_code, profile_id")
        .eq("email", email)
        .maybeSingle();

      if (existing) {
        investorId = existing.id;
        investorCode = existing.investor_code;
        investorProfileId = existing.profile_id;
      } else {
        isNewInvestor = true;

        // Auth account (creates the user, sends nothing)
        const { data: linkData, error: linkErr } =
          await adminClient.auth.admin.generateLink({
            type: "invite",
            email,
            options: {
              data: { full_name: row.full_name, role: "investor" },
              redirectTo: `${ctx.siteUrl}/investor/dashboard`,
            },
          });

        let profileId: string;
        if (linkErr || !linkData?.user) {
          // The auth user may exist from an interrupted run — recover
          // through the profiles table.
          const { data: orphanProfile } = await adminClient
            .from("profiles")
            .select("id")
            .eq("email", email)
            .maybeSingle();
          if (!orphanProfile) {
            throw new Error(
              "Could not create portal account: " +
                (linkErr?.message ?? "unknown auth error")
            );
          }
          profileId = orphanProfile.id;
        } else {
          profileId = linkData.user.id;
        }

        await adminClient.from("profiles").upsert(
          {
            id: profileId,
            email,
            full_name: row.full_name,
            role: "investor",
          },
          { onConflict: "id" }
        );

        // Secure random MG-XXXXXX code — never typed by staff
        investorCode = await generateUniqueInvestorCode(async (code) => {
          const { data } = await adminClient
            .from("investors")
            .select("id")
            .eq("investor_code", code)
            .maybeSingle();
          return !!data;
        });

        const { data: newInvestor, error: invErr } = await adminClient
          .from("investors")
          .insert({
            profile_id: profileId,
            investor_code: investorCode,
            full_name: row.full_name,
            email,
            phone: row.phone,
            address: row.address,
            invitation_status: "not_sent",
            created_by: ctx.userId,
            onboarded_at: new Date().toISOString(),
          })
          .select("id, profile_id")
          .single();
        if (invErr || !newInvestor) {
          throw new Error("Failed to create investor: " + invErr?.message);
        }
        investorId = newInvestor.id;
        investorProfileId = newInvestor.profile_id;
      }
      await save({ investor_id: investorId });
    }

    if (!investorCode || !investorId) throw new Error("Investor resolution failed");

    // ── Step 2: investment ──
    let investmentId = row.investment_id;
    if (!investmentId) {
      const baseCode = `MG-${ctx.series.name}-${String(ctx.cycle.cycle_number).padStart(3, "0")}-${investorCode}`;
      const { count } = await adminClient
        .from("investments")
        .select("id", { count: "exact", head: true })
        .like("investment_code", `${baseCode}%`);
      const investmentCode =
        !count || count === 0 ? baseCode : `${baseCode}-${count + 1}`;

      const historical = HISTORICAL_CYCLE_STATUSES.includes(ctx.cycle.status);

      const { data: investment, error: investErr } = await adminClient
        .from("investments")
        .insert({
          investment_code: investmentCode,
          investor_id: investorId,
          series_id: ctx.series.id,
          cycle_id: ctx.cycle.id,
          units: slots,
          price_per_unit: SLOT_VALUE_NGN,
          capital,
          investment_date: row.payment_date ?? ctx.cycle.start_date,
          maturity_date: ctx.cycle.end_date,
          // Historical cycles are imported as completed records, never
          // auto-activated. Active-cycle imports are live and therefore
          // automatically eligible for future rollovers.
          status: historical ? "completed" : "active",
          notes: row.notes ?? "Migrated from legacy records",
          created_by: ctx.userId,
        })
        .select("id")
        .single();
      if (investErr || !investment) {
        throw new Error("Failed to create investment: " + investErr?.message);
      }
      investmentId = investment.id;
      await save({ investment_id: investmentId });
    }

    // ── Step 3: payment record (skipped if it already exists) ──
    if (Number(row.amount_paid) > 0 && row.payment_date) {
      const { data: existingPayment } = await adminClient
        .from("investment_payments")
        .select("id")
        .eq("investment_id", investmentId)
        .eq("amount", Number(row.amount_paid))
        .eq("payment_date", row.payment_date)
        .maybeSingle();

      if (!existingPayment) {
        const { error: payErr } = await adminClient
          .from("investment_payments")
          .insert({
            investment_id: investmentId,
            investor_id: investorId,
            amount: Number(row.amount_paid),
            payment_date: row.payment_date,
            reference: row.payment_reference,
            created_by: ctx.userId,
          });
        if (payErr) {
          throw new Error("Failed to record payment: " + payErr.message);
        }
      }
    }

    // ── Step 4: invitation email (only "now" mode; failures never fail the row) ──
    if (ctx.emailMode === "now" && isNewInvestor && investorProfileId) {
      const { data: linkData } = await adminClient.auth.admin.generateLink({
        type: "invite",
        email,
        options: {
          data: { full_name: row.full_name, role: "investor" },
          redirectTo: `${ctx.siteUrl}/investor/dashboard`,
        },
      });
      const passwordSetupLink =
        linkData?.properties?.action_link ?? `${ctx.siteUrl}/login`;
      const totalPaid = Number(row.amount_paid) || 0;

      const result = await sendOnboardingEmail({
        to: email,
        fullName: row.full_name,
        investorCode,
        email,
        passwordSetupLink,
        portalLink: ctx.siteUrl,
        seriesName: ctx.series.name,
        cycleLabel: ctx.cycle.cycle_label,
        slots,
        slotValue: SLOT_VALUE_NGN,
        totalInvestment: capital,
        totalPaid,
        outstandingBalance: Math.max(0, capital - totalPaid),
        paymentStatus: getPaymentStatus(capital, totalPaid),
        paymentDate: row.payment_date ?? undefined,
        cycleStart: ctx.cycle.start_date,
        maturityDate: ctx.cycle.end_date,
      });

      await adminClient
        .from("investors")
        .update({
          invitation_status: result.success ? "sent" : "failed",
          ...(result.success
            ? { invitation_sent_at: new Date().toISOString() }
            : {}),
        })
        .eq("id", investorId);
    }

    await save({
      status: "imported",
      error: null,
      processed_at: new Date().toISOString(),
    });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await save({
      status: "failed",
      error: message,
      processed_at: new Date().toISOString(),
    });
    return { ok: false, error: message };
  }
}

// ─── POST: process the next chunk of rows (resumable) ───────────────
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  try {
    const body = (await request.json().catch(() => ({}))) as {
      email_mode?: "now" | "queue" | "none";
      limit?: number;
      retry_failed?: boolean;
    };
    const limit = Math.min(Math.max(body.limit ?? CHUNK_DEFAULT, 1), 50);

    const adminClient = await createAdminClient();
    const { data: batch } = await adminClient
      .from("migration_batches")
      .select(
        "*, series:series_id(id, name), cycle:cycle_id(id, cycle_number, cycle_label, start_date, end_date, status)"
      )
      .eq("id", id)
      .single();

    if (!batch) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }
    if (batch.status === "cancelled") {
      return NextResponse.json(
        { error: "This batch has been cancelled" },
        { status: 400 }
      );
    }

    if (body.email_mode && batch.email_mode !== body.email_mode) {
      await adminClient
        .from("migration_batches")
        .update({ email_mode: body.email_mode, status: "importing" })
        .eq("id", id);
      batch.email_mode = body.email_mode;
    } else if (batch.status === "reviewing") {
      await adminClient
        .from("migration_batches")
        .update({ status: "importing" })
        .eq("id", id);
    }

    // Importable rows: valid, resolved duplicates, and (on retry) failed.
    // Imported/skipped/invalid rows are never touched again — this is
    // what makes re-running after a crash safe and resumable.
    const statuses = body.retry_failed
      ? ["valid", "duplicate", "failed"]
      : ["valid", "duplicate"];

    const { data: pendingRows } = await adminClient
      .from("migration_rows")
      .select("*")
      .eq("batch_id", id)
      .in("status", statuses)
      .order("row_number")
      .limit(limit);

    const rows = (pendingRows ?? []).filter(
      (r) => r.status !== "duplicate" || r.action === "attach"
    );

    const ctx: BatchCtx = {
      batchId: id,
      userId: auth.userId,
      emailMode: batch.email_mode,
      series: batch.series as unknown as BatchCtx["series"],
      cycle: batch.cycle as unknown as BatchCtx["cycle"],
      siteUrl: SITE_URL,
    };

    let processed = 0;
    let failed = 0;
    for (const row of rows) {
      const result = await processRow(adminClient, ctx, row);
      if (result.ok) processed++;
      else failed++;
    }

    // Recompute counters + remaining work
    const { data: allRows } = await adminClient
      .from("migration_rows")
      .select("status, action")
      .eq("batch_id", id);

    const counts = { imported: 0, failed: 0, skipped: 0, remaining: 0 };
    for (const r of allRows ?? []) {
      if (r.status === "imported") counts.imported++;
      else if (r.status === "failed") counts.failed++;
      else if (r.status === "skipped") counts.skipped++;
      else if (
        r.status === "valid" ||
        (r.status === "duplicate" && r.action === "attach")
      )
        counts.remaining++;
    }

    const done = counts.remaining === 0;
    await adminClient
      .from("migration_batches")
      .update({
        imported_count: counts.imported,
        failed_count: counts.failed,
        skipped_count: counts.skipped,
        ...(done
          ? { status: "completed", completed_at: new Date().toISOString() }
          : {}),
      })
      .eq("id", id);

    return NextResponse.json({
      processed,
      failed_in_chunk: failed,
      ...counts,
      done,
    });
  } catch (err) {
    console.error("[API] POST import error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
