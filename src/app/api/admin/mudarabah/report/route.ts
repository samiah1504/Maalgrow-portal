import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import {
  loadCreditNote,
  loadReportSource,
  holdingFor,
} from "@/lib/mudarabah/report-source";
import {
  renderCreditNoteDocument,
  renderReportDocument,
} from "@/lib/mudarabah/report-html";

const ADMIN_ROLES = ["super_admin", "administrator"];

// GET /api/admin/mudarabah/report?cycleId=…
//
//   (no investmentId)          → the cycle's holders, as JSON, for the
//                                preview's investor picker
//   &investmentId=…            → that investor's report, as an HTML
//                                document the browser can print
//   &investmentId=…&doc=note   → their withholding tax credit note
//
// Admin only. Per-product figures never enter the response: the
// renderer is fed ReportFigures, which has no product-shaped field.
export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (!profile || !ADMIN_ROLES.includes(profile.role ?? "")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const url = new URL(request.url);
    const cycleId = url.searchParams.get("cycleId");
    const investmentId = url.searchParams.get("investmentId");
    const doc = url.searchParams.get("doc");

    if (!cycleId) {
      return NextResponse.json({ error: "cycleId is required" }, { status: 400 });
    }

    const admin = await createAdminClient();
    const source = await loadReportSource(admin, cycleId);
    if (!source) {
      return NextResponse.json({ error: "No such cycle" }, { status: 404 });
    }

    if (!investmentId) {
      return NextResponse.json({
        cycle: {
          seriesName: source.cycle.seriesName,
          cycleLabel: source.cycle.cycleLabel,
          startDate: source.cycle.startDate,
          endDate: source.cycle.endDate,
          description: source.cycle.description,
          totalUnits: source.cycle.totalUnits,
          investorCount: source.cycle.investorCount,
        },
        provisional: source.figures.provisional,
        settledAt: source.figures.settledAt,
        missingLedger: source.missingLedger,
        netPerSlot: source.figures.netPerSlot,
        holders: source.holdings.map((h) => ({
          investmentId: h.investmentId,
          investorName: h.investorName,
          investorCode: h.investorCode,
          units: h.units,
          decision: h.decision,
        })),
      });
    }

    const holding = holdingFor(source, investmentId);
    if (!holding) {
      return NextResponse.json(
        { error: "That investor does not hold slots in this cycle" },
        { status: 404 }
      );
    }

    const html =
      doc === "note"
        ? await (async () => {
            const note = await loadCreditNote(
              admin,
              cycleId,
              investmentId,
              source.cycle
            );
            return note ? renderCreditNoteDocument(note) : null;
          })()
        : renderReportDocument(source.figures, source.cycle, holding);

    if (html === null) {
      return NextResponse.json(
        {
          error:
            "No credit note yet. Notes are issued once the tax has been filed and the remittance reference recorded.",
        },
        { status: 404 }
      );
    }

    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        // A preview must never be a stale one
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not build the report" },
      { status: 500 }
    );
  }
}
