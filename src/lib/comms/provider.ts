/**
 * Communication provider abstraction.
 *
 * The Communication Centre depends ONLY on this interface — never on
 * a concrete provider. Sendchamp is the current implementation
 * (./sendchamp.ts); to switch providers, implement CommsProvider and
 * change one line in getCommsProvider().
 */

export type SendResult = {
  success: boolean;
  providerMessageId?: string;
  /** Raw provider response, stored for auditing */
  response: unknown;
  error?: string;
  /** True when a retry may succeed (network / rate limit / 5xx) */
  retryable: boolean;
};

export type SmsParams = {
  /** International format without +, e.g. 2348012345678 */
  to: string;
  message: string;
};

export type WhatsAppParams = {
  to: string;
  message: string;
  /** Provider-approved template code (plain text used when absent) */
  templateCode?: string | null;
  headerMediaUrl?: string | null;
};

export interface CommsProvider {
  readonly name: string;
  sendSms(params: SmsParams): Promise<SendResult>;
  sendWhatsApp(params: WhatsAppParams): Promise<SendResult>;
}

import { SendchampProvider } from "./sendchamp";

let cached: CommsProvider | null = null;

export function getCommsProvider(): CommsProvider {
  if (!cached) {
    // Swap the provider here — the rest of the app never changes.
    cached = new SendchampProvider();
  }
  return cached;
}
