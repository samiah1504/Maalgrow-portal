/**
 * Canonical public URL of the MaalGrow portal.
 *
 * Set NEXT_PUBLIC_SITE_URL in the environment (Vercel → Settings →
 * Environment Variables) — every email link, password-setup link, and
 * auth redirect is built from this single value. The fallback below is
 * only used when the variable is missing.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://maalgrow.maalvest.com"
).replace(/\/+$/, "");
