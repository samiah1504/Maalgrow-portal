/** Cycle documents: what may be uploaded, and where it is kept. */
export const MAALRISE_DOCUMENTS_BUCKET = "maalrise-documents";
export const MAALRISE_DOC_MAX_BYTES = 15 * 1024 * 1024;
export const MAALRISE_DOC_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/msword": "doc",
};
export const MAALRISE_DOC_CATEGORIES = ["contract", "supporting"] as const;
export type MaalriseDocCategory = (typeof MAALRISE_DOC_CATEGORIES)[number];

/** A storage key that keeps the original name readable but harmless. */
export function documentPath(cycleId: string, fileId: string, name: string, ext: string) {
  const base = name.replace(/\.[^.]*$/, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "document";
  return `cycles/${cycleId}/${fileId}-${base}.${ext}`;
}
