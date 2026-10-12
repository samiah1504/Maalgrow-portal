/**
 * Upload a Cycle contract or supporting document. Preparing roles only.
 *
 * Same pattern as MaalGrow's private files: the server checks the
 * person's role, uploads to the PRIVATE maalrise-documents bucket with
 * the server key (the bucket has no public or user access at all), and
 * then records the document AS THE SIGNED-IN PERSON through
 * maalrise_register_document, which checks the role again. If that
 * refuses, the file is removed.
 */
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { MAALRISE_PREPARE_ROLES } from "@/lib/maalrise/permissions";
import { dbError, isUuid, maalriseGate } from "@/lib/maalrise/api";
import {
  MAALRISE_DOCUMENTS_BUCKET,
  MAALRISE_DOC_CATEGORIES,
  MAALRISE_DOC_MAX_BYTES,
  MAALRISE_DOC_TYPES,
  documentPath,
} from "@/lib/maalrise/documents";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await maalriseGate(MAALRISE_PREPARE_ROLES);
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Unknown Cycle." }, { status: 404 });

  const { data: cycle, error } = await gate.db.from("maalrise_cycles").select("id").eq("id", id).maybeSingle();
  if (error) return dbError(error);
  if (!cycle) return NextResponse.json({ error: "Unknown Cycle." }, { status: 404 });

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const category = String(form?.get("category") ?? "");
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });
  if (!(MAALRISE_DOC_CATEGORIES as readonly string[]).includes(category)) {
    return NextResponse.json({ error: "Choose whether this is the contract or a supporting document." }, { status: 400 });
  }
  const ext = MAALRISE_DOC_TYPES[file.type];
  if (!ext) return NextResponse.json({ error: "Upload a PDF, Word document or image (PNG/JPEG)." }, { status: 400 });
  if (file.size > MAALRISE_DOC_MAX_BYTES) return NextResponse.json({ error: "The file is larger than 15 MB." }, { status: 400 });

  const path = documentPath(id, randomUUID(), file.name, ext);
  const admin = await createAdminClient();
  const up = await admin.storage
    .from(MAALRISE_DOCUMENTS_BUCKET)
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
  if (up.error) return NextResponse.json({ error: `Upload failed: ${up.error.message}` }, { status: 502 });

  const reg = await gate.db.rpc("maalrise_register_document", {
    p: {
      cycle_id: id,
      category,
      name: file.name.slice(0, 200),
      storage_path: path,
      mime_type: file.type,
      size_bytes: file.size,
      visible_to_investors: false,
    },
  });
  if (reg.error) {
    await admin.storage.from(MAALRISE_DOCUMENTS_BUCKET).remove([path]);
    return dbError(reg.error);
  }
  return NextResponse.json({ id: reg.data }, { status: 201 });
}
