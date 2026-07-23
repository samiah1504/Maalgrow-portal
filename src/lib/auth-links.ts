import { SITE_URL } from "@/lib/site-url";

type GenerateLinkProperties =
  | {
      action_link?: string | null;
      hashed_token?: string | null;
      verification_type?: string | null;
    }
  | null
  | undefined;

/**
 * Builds the password-setup link that goes into investor emails.
 *
 * Never email the raw Supabase action_link: it is a one-time URL that
 * is consumed by the FIRST request — WhatsApp link previews and email
 * security scanners fetch it automatically, so by the time the
 * investor taps it the token is already burned and they see
 * "link expired".
 *
 * Instead we link to our own /reset-password page carrying the
 * token_hash. Opening the page consumes nothing; the token is only
 * redeemed (verifyOtp) when the investor actually clicks
 * "Set New Password".
 */
export function buildPasswordSetupLink(
  properties: GenerateLinkProperties,
  fallbackType: "invite" | "recovery"
): string {
  const tokenHash = properties?.hashed_token;
  if (!tokenHash) {
    return `${SITE_URL}/login`;
  }
  const type = properties?.verification_type ?? fallbackType;
  return `${SITE_URL}/reset-password?token_hash=${encodeURIComponent(
    tokenHash
  )}&type=${encodeURIComponent(type)}`;
}
