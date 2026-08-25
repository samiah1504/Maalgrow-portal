/**
 * A one-time password for an investor who cannot get in.
 *
 * GENERATED, NOT TYPED. A password an administrator invents is a
 * password they will invent again for the next investor, and probably
 * a variation of the same one. This is random from a cryptographic
 * source, so no two are related and nobody has to think of one under
 * pressure.
 *
 * READABLE OVER THE PHONE. That is the whole delivery mechanism: it
 * is never emailed, so somebody has to say it aloud or type it into a
 * message. So no characters that are ambiguous when spoken or read —
 * no 0/O, no 1/l/I — and it is grouped, because "read me the middle
 * four" is how these calls actually go.
 *
 * SERVER ONLY.
 */

import { randomInt } from "node:crypto";

// Deliberately missing: 0 O o 1 l I. What is left is unambiguous
// aloud and still leaves plenty of room.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

/**
 * Three groups of four, e.g. "Kw7R-pQ2m-Xj9T".
 *
 * randomInt, not Math.random: this is a credential, and Math.random
 * is predictable from previous outputs.
 */
export function generateTemporaryPassword(): string {
  const groups: string[] = [];
  for (let g = 0; g < 3; g++) {
    let group = "";
    for (let i = 0; i < 4; i++) {
      group += ALPHABET[randomInt(ALPHABET.length)];
    }
    groups.push(group);
  }
  return groups.join("-");
}
