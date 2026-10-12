/**
 * Open a Cycle document. The record is read AS THE SIGNED-IN PERSON, so
 * row level security decides whether they may see it; only then is a
 * one-minute signed link issued for the private file.
 */
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { dbError, isUuid, maalriseGate } from "@/lib/maalrise/api";
import { MAALRISE_DOCUMENTS_BUCKET } from "@/lib/maalrise/documents";

const STAFF = ["super_admin", "administrator", "operations", "finance", "customer_support"];

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await maalriseGate(STAFF);
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Unknown document." }, { status: 404 });

  const { data: doc, error } = await gate.db.from("maalrise_documents").select("storage_path, name").eq("id", id).maybeSingle();
  if (error) return dbError(error);
  if (!doc) return NextResponse.json({ error: "Unknown document." }, { status: 404 });

  const admin = await createAdminClient();
  const signed = await admin.storage.from(MAALRISE_DOCUMENTS_BUCKET).createSignedUrl(doc.storage_path as string, 60, {
    download: doc.name as string,
  });
  if (signed.error || !signed.data?.signedUrl) {
    return NextResponse.json({ error: "The file could not be opened." }, { status: 502 });
  }
  return NextResponse.redirect(signed.data.signedUrl);
}
