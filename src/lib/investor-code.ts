import { randomBytes } from "crypto";

// 32-character alphabet — excludes O, 0 (zero), I, 1 (one) to prevent confusion.
// 256 % 32 === 0, so `byte % 32` has no modulo bias.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;
const MAX_RETRIES = 5;

function generateCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return `MG-${code}`;
}

/**
 * Generates a cryptographically random investor code in the format MG-XXXXXX.
 * Retries up to MAX_RETRIES times if a collision is detected.
 *
 * @param checkExists - async function that returns true if the code already exists in the DB
 */
export async function generateUniqueInvestorCode(
  checkExists: (code: string) => Promise<boolean>
): Promise<string> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const code = generateCode();
    const exists = await checkExists(code);
    if (!exists) return code;
  }
  throw new Error(
    "Failed to generate a unique investor code after multiple attempts"
  );
}
