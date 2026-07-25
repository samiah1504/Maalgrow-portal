import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireCommsAdmin } from "@/lib/comms/server";

const ALLOWED: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xls",
  "text/csv": "csv",
};
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB — safely under Resend's limit

// POST multipart: file → stores the shared campaign report in the
// PRIVATE comm-attachments bucket. Returns {path,name,mime,size} for
// campaign creation. No public URLs are ever created.
export async function POST(request: Request) {
  const auth = await requireCommsAdmin();
  if (!auth.ok) return auth.response;

  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }
    const ext = ALLOWED[file.type];
    if (!ext) {
      return NextResponse.json(
        { error: "Only PDF, Excel and CSV attachments are allowed" },
        { status: 400 }
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: "Attachment is too large (maximum 10 MB)" },
        { status: 400 }
      );
    }

    const safeName = (file.name || `report.${ext}`)
      .replace(/[^\w.\-() ]+/g, "_")
      .slice(0, 120);
    const path = `shared/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const db = await createAdminClient();
    const { error } = await db.storage
      .from("comm-attachments")
      .upload(path, Buffer.from(await file.arrayBuffer()), {
        contentType: file.type,
        upsert: false,
      });
    if (error) {
      return NextResponse.json(
        { error: "Upload failed: " + error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      attachment: { path, name: safeName, mime: file.type, size: file.size },
    });
  } catch (err) {
    console.error("[API] POST /admin/comms/attachment error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
