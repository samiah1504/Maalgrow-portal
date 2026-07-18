import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

const ALLOWED_ROLES = ["super_admin", "administrator"];

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

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

    if (!profile || !ALLOWED_ROLES.includes(profile.role ?? "")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = (await request.json()) as {
      description?: string | null;
      mudarabah_investor_ratio?: number;
      price_per_unit?: number;
      min_units?: number;
      max_units?: number | null;
      is_active?: boolean;
    };

    const {
      description,
      mudarabah_investor_ratio,
      price_per_unit,
      min_units,
      max_units,
      is_active,
    } = body;

    if (
      mudarabah_investor_ratio !== undefined &&
      (typeof mudarabah_investor_ratio !== "number" ||
        mudarabah_investor_ratio <= 0 ||
        mudarabah_investor_ratio >= 1)
    ) {
      return NextResponse.json(
        { error: "Investor profit share must be between 1% and 99%" },
        { status: 400 }
      );
    }

    if (
      price_per_unit !== undefined &&
      (typeof price_per_unit !== "number" || price_per_unit <= 0)
    ) {
      return NextResponse.json(
        { error: "Slot value must be a positive number" },
        { status: 400 }
      );
    }

    if (min_units !== undefined) {
      if (typeof min_units !== "number" || min_units < 0.5) {
        return NextResponse.json(
          { error: "Minimum slots must be at least 0.5" },
          { status: 400 }
        );
      }
      if (!Number.isInteger(min_units * 2)) {
        return NextResponse.json(
          { error: "Minimum slots must be a multiple of 0.5 (e.g. 0.5, 1, 1.5, 2…)" },
          { status: 400 }
        );
      }
    }

    if (max_units !== null && max_units !== undefined && typeof max_units === "number") {
      if (max_units < 0.5) {
        return NextResponse.json(
          { error: "Maximum slots must be at least 0.5" },
          { status: 400 }
        );
      }
      if (min_units !== undefined && max_units < min_units) {
        return NextResponse.json(
          { error: "Maximum slots must be greater than or equal to minimum slots" },
          { status: 400 }
        );
      }
    }

    const adminClient = await createAdminClient();

    const { data: existing } = await adminClient
      .from("series")
      .select("id")
      .eq("id", id)
      .single();

    if (!existing) {
      return NextResponse.json({ error: "Series not found" }, { status: 404 });
    }

    const { data: updated, error: updateError } = await adminClient
      .from("series")
      .update({
        ...(description !== undefined ? { description } : {}),
        ...(mudarabah_investor_ratio !== undefined ? { mudarabah_investor_ratio } : {}),
        ...(price_per_unit !== undefined ? { price_per_unit } : {}),
        ...(min_units !== undefined ? { min_units } : {}),
        ...(max_units !== undefined ? { max_units } : {}),
        ...(is_active !== undefined ? { is_active } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (updateError) {
      console.error("[API] PATCH /admin/series error:", updateError);
      return NextResponse.json(
        { error: "Failed to update series: " + updateError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ series: updated });
  } catch (err) {
    console.error("[API] PATCH /admin/series unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
