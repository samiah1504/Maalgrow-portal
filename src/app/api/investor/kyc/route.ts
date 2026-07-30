import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import {
  ADDRESS_INCOMPLETE_MESSAGE,
  validateResidentialAddress,
} from "@/lib/residential-address";
import { findLga, findState } from "@/lib/nigeria-geo";

const PHONE_RE = /^[+\d][\d\s-]{8,}$/;
const GENDERS = ["female", "male", "prefer_not_to_say"];

// Investor submits (or resubmits/updates) their own KYC. Server-side
// validation mirrors the form; kyc_submitted_at/kyc_status are set via
// the service role because a DB trigger blocks investors from setting
// them directly. Every submission goes back to pending so an admin can
// (bulk) approve it — an approved record is never silently kept
// approved after important details change.
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const adminClient = await createAdminClient();
    const { data: investor } = await adminClient
      .from("investors")
      .select("id, kyc_status, kyc_submitted_at, gender, nationality, occupation, bank_name, account_number, phone, address, full_name")
      .eq("profile_id", user.id)
      .maybeSingle();

    if (!investor) {
      return NextResponse.json(
        { error: "No investor account is linked to this login" },
        { status: 404 }
      );
    }

    const body = (await request.json()) as Record<string, unknown>;
    const s = (key: string) =>
      typeof body[key] === "string" ? (body[key] as string).trim() : "";

    const phone = s("phone");
    const nin = s("nin") || null;
    const bankName = s("bank_name");
    const accountName = s("account_name");
    const accountNumber = s("account_number");
    const gender = s("gender");
    const nationality = s("nationality");
    const occupation = s("occupation");
    const nokFullName = s("nok_full_name");
    const nokRelationship = s("nok_relationship");
    const nokPhone = s("nok_phone");
    const nokAltPhone = s("nok_alternative_phone") || null;
    const nokEmail = s("nok_email") || null;
    const nokAddress = s("nok_address");
    const nokCity = s("nok_city");
    const nokState = s("nok_state");
    const nokCountry = s("nok_country");

    const bad = (msg: string) => NextResponse.json({ error: msg }, { status: 400 });

    if (phone.replace(/\D/g, "").length < 10) return bad("Enter a valid phone number");

    /*
     * The residential address, checked here and not only in the form.
     *
     * The form sends CODES; the names are looked up on this side from
     * the same list rather than trusted from the request, so a caller
     * cannot post "LA" with the name "Kano" and have it stored. Every
     * one of the four is required — this is the gate the whole change
     * exists for.
     */
    const addressValue = {
      street: s("residential_street_address"),
      stateCode: s("residential_state_code"),
      lgaCode: s("residential_lga_code"),
      city: s("residential_city"),
    };
    const addressProblems = validateResidentialAddress(addressValue);
    if (Object.keys(addressProblems).length > 0) {
      return bad(ADDRESS_INCOMPLETE_MESSAGE);
    }
    const stateRow = findState(addressValue.stateCode);
    const lgaRow = findLga(addressValue.lgaCode);
    if (nin !== null && !/^\d{11}$/.test(nin)) return bad("NIN must be exactly 11 digits");
    if (bankName.length < 2) return bad("Enter your bank name");
    if (accountName.length < 3) return bad("Enter the account name");
    if (!/^\d{10}$/.test(accountNumber)) return bad("Account number must be 10 digits");
    if (!GENDERS.includes(gender)) return bad("Select your gender");
    if (nationality.length < 2) return bad("Enter your nationality");
    if (occupation.length < 2) return bad("Enter your occupation");
    if (nokFullName.length < 3) return bad("Enter your next of kin's full name");
    if (!nokRelationship) return bad("Select your next of kin's relationship to you");
    if (!PHONE_RE.test(nokPhone) || nokPhone.replace(/\D/g, "").length < 10)
      return bad("Enter a valid next-of-kin phone number");
    if (nokAltPhone && !PHONE_RE.test(nokAltPhone))
      return bad("Enter a valid alternative phone number");
    if (nokEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nokEmail))
      return bad("Enter a valid next-of-kin email address");
    if (nokAddress.length < 5) return bad("Enter your next of kin's address");
    if (nokCity.length < 2) return bad("Enter your next of kin's city");
    if (nokState.length < 2) return bad("Enter your next of kin's state");
    if (nokCountry.length < 2) return bad("Enter your next of kin's country");

    // Upsert the next of kin (one primary contact per investor)
    const { error: nokError } = await adminClient.from("next_of_kin").upsert(
      {
        investor_id: investor.id,
        full_name: nokFullName,
        relationship: nokRelationship,
        phone: nokPhone,
        alternative_phone: nokAltPhone,
        email: nokEmail,
        address: nokAddress,
        city: nokCity,
        state: nokState,
        country: nokCountry,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "investor_id" }
    );
    if (nokError) {
      return NextResponse.json(
        { error: "Failed to save next of kin: " + nokError.message },
        { status: 500 }
      );
    }

    const wasApproved = investor.kyc_status === "approved";

    const { error: updateError } = await adminClient
      .from("investors")
      .update({
        phone,
        // investors.address is LEFT ALONE. It is the record of what
        // they told us before the address had parts, and 042 keeps it
        // on purpose.
        residential_street_address: addressValue.street,
        residential_state_code: stateRow?.code ?? null,
        residential_state_name: stateRow?.name ?? null,
        residential_lga_code: lgaRow?.code ?? null,
        residential_lga_name: lgaRow?.name ?? null,
        residential_city: addressValue.city,
        nin,
        bank_name: bankName,
        account_name: accountName,
        account_number: accountNumber,
        gender,
        nationality,
        occupation,
        // Every (re)submission goes back for review
        kyc_status: "pending",
        kyc_submitted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", investor.id);

    if (updateError) {
      return NextResponse.json(
        { error: "Failed to save KYC: " + updateError.message },
        { status: 500 }
      );
    }

    // Audit trail (attributed to the investor's session)
    await supabase.rpc("create_audit_log", {
      p_action: wasApproved ? "kyc_update_submitted" : "kyc_submitted",
      p_entity_type: "investor",
      p_entity_id: investor.id,
      p_old_values: {
        kyc_status: investor.kyc_status,
        gender: investor.gender,
        nationality: investor.nationality,
        occupation: investor.occupation,
      },
      p_new_values: { kyc_status: "pending", gender, nationality, occupation },
    });

    // Let admins know there is a KYC submission to review
    const { data: admins } = await adminClient
      .from("profiles")
      .select("id")
      .in("role", ["super_admin", "administrator"])
      .eq("is_active", true);

    if (admins && admins.length > 0) {
      await adminClient.from("notifications").insert(
        admins.map((a) => ({
          user_id: a.id,
          title: wasApproved ? "KYC Update Submitted" : "KYC Submitted for Review",
          message: `${investor.full_name} has ${
            wasApproved
              ? "updated their KYC details (previously approved)"
              : investor.kyc_status === "rejected"
              ? "resubmitted their KYC details"
              : "submitted their KYC details"
          }. Review and approve in the KYC centre.`,
          type: "system" as const,
          action_url: `/admin/kyc`,
        }))
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[API] POST /investor/kyc error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
