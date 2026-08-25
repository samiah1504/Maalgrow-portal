/**
 * The one-time password an administrator can set.
 *
 * Two things it must be, and they pull against each other: hard to
 * guess, and possible to read down a phone line. The alphabet is the
 * compromise — and the characters LEFT OUT are the part worth testing,
 * because a password containing both O and 0 gets read out wrong,
 * typed wrong, and reported as "it says my password is incorrect",
 * which is the exact complaint this feature exists to end.
 *
 *   npx tsx scripts/test-temporary-password.ts
 */
import { generateTemporaryPassword } from "../src/lib/temporary-password";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log("PASS:", name);
  else {
    failures++;
    console.error("FAIL:", name, detail ?? "");
  }
}

const sample = Array.from({ length: 2000 }, () => generateTemporaryPassword());

check("it looks like three groups of four", /^[^-]{4}-[^-]{4}-[^-]{4}$/.test(sample[0]), sample[0]);
check("every one does", sample.every((p) => /^[^-]{4}-[^-]{4}-[^-]{4}$/.test(p)));

// THE ONES THAT CAUSE THE SUPPORT CALL. Read "0" aloud and you get
// "O"; read "l" and you get "1" or "I".
for (const ch of ["0", "O", "o", "1", "l", "I"]) {
  check(
    `never contains "${ch}"`,
    !sample.some((p) => p.includes(ch)),
    sample.find((p) => p.includes(ch))
  );
}

check(
  "and no whitespace, which does not survive being dictated",
  !sample.some((p) => /\s/.test(p))
);

// Not a proof of randomness — just that it is not returning the same
// thing, which is the way this breaks in practice.
check("no two are the same", new Set(sample).size === sample.length,
  sample.length - new Set(sample).size);

// Every position should vary across the sample. A generator with a
// stuck index looks fine in one sample and is catastrophic.
const positions = [0, 1, 2, 3, 5, 6, 7, 8, 10, 11, 12, 13];
check(
  "every character position varies",
  positions.every((i) => new Set(sample.map((p) => p[i])).size > 5),
  positions.filter((i) => new Set(sample.map((p) => p[i])).size <= 5)
);

// 55 characters, 12 of them: ~69 bits. Far past anything guessable,
// and this asserts the alphabet was not accidentally narrowed.
const alphabet = new Set(sample.join("").replace(/-/g, "").split(""));
check(
  "the alphabet is wide enough to be unguessable",
  alphabet.size >= 50,
  alphabet.size
);

console.log(
  failures === 0 ? "\nALL TEMPORARY PASSWORD TESTS PASSED" : `\n${failures} FAILED`
);
process.exit(failures === 0 ? 0 : 1);
