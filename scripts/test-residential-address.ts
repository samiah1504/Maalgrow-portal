/**
 * The structured residential address.
 *
 * Two things are being protected here.
 *
 * THE DATA IS RIGHT. 774 local government areas typed out by hand is
 * exactly the kind of list that quietly ends up with 771 of them, a
 * duplicate, or a state whose LGAs went missing. Nothing downstream
 * would notice — an investor would simply fail to find their own LGA
 * and put in the nearest wrong one.
 *
 * THE RULE IS ONE RULE. What "complete" means is written three times:
 * in the form, in validateResidentialAddress, and in SQL as
 * residential_address_missing(). The labels and their ORDER have to
 * match the SQL, because the admin screen shows one and the KYC gate
 * uses the other, and an investor told to fix a field that is already
 * filled in will simply give up.
 *
 *   npx tsx scripts/test-residential-address.ts
 */
import {
  NIGERIAN_STATES,
  NIGERIAN_LGAS,
  findState,
  findLga,
  lgasForState,
  lgaBelongsToState,
  stateCodeFromName,
  formatStructuredAddress,
} from "../src/lib/nigeria-geo";
import {
  EMPTY_ADDRESS,
  addressToColumns,
  addressFromRow,
  isAddressComplete,
  storedAddressMissing,
  validateResidentialAddress,
} from "../src/lib/residential-address";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log("PASS:", name);
  else {
    failures++;
    console.error("FAIL:", name, detail ?? "");
  }
}

/* ── The list itself ──────────────────────────────────────────── */

check(
  "36 states and the Federal Capital Territory",
  NIGERIAN_STATES.length === 37,
  NIGERIAN_STATES.length
);
check("774 local government areas", NIGERIAN_LGAS.length === 774, NIGERIAN_LGAS.length);

const stateCodes = new Set(NIGERIAN_STATES.map((s) => s.code));
check("every state code is unique", stateCodes.size === 37);
check(
  "every state name is unique",
  new Set(NIGERIAN_STATES.map((s) => s.name)).size === 37
);

const lgaCodes = new Set(NIGERIAN_LGAS.map((l) => l.code));
check(
  "every LGA code is unique",
  lgaCodes.size === NIGERIAN_LGAS.length,
  NIGERIAN_LGAS.length - lgaCodes.size
);
check(
  "every LGA belongs to a state that exists",
  NIGERIAN_LGAS.every((l) => stateCodes.has(l.stateCode)),
  NIGERIAN_LGAS.filter((l) => !stateCodes.has(l.stateCode)).map((l) => l.code)
);
const empty = NIGERIAN_STATES.filter((s) => lgasForState(s.code).length === 0);
check("no state is left without any", empty.length === 0, empty.map((s) => s.name));

// THE ONE THE DATABASE CONSTRAINT DEPENDS ON. investors_residential_
// lga_in_state checks that the LGA code starts with the state code —
// so if a code were ever generated any other way, every address in
// that state would be rejected on save with no obvious reason.
check(
  "every LGA code starts with its state's code",
  NIGERIAN_LGAS.every((l) => l.code.startsWith(`${l.stateCode}-`)),
  NIGERIAN_LGAS.filter((l) => !l.code.startsWith(`${l.stateCode}-`)).slice(0, 3)
);

// Spot checks on counts that are widely published, so a whole state
// quietly losing entries in an edit is caught.
check("Kano has 44", lgasForState("KN").length === 44, lgasForState("KN").length);
check("Lagos has 20", lgasForState("LA").length === 20, lgasForState("LA").length);
check("the FCT has 6", lgasForState("FC").length === 6, lgasForState("FC").length);
check("Bayelsa has 8", lgasForState("BY").length === 8, lgasForState("BY").length);
check("Katsina has 34", lgasForState("KT").length === 34, lgasForState("KT").length);

check(
  "Ikeja is in Lagos and nowhere else",
  findLga("LA-IKEJA")?.stateCode === "LA" &&
    NIGERIAN_LGAS.filter((l) => l.name === "Ikeja").length === 1
);
// Several LGA NAMES legitimately repeat across states — Obi is in
// both Benue and Nasarawa, Surulere in Lagos and Oyo. The codes must
// still be distinct, which is why they are prefixed.
check(
  "a name shared by two states gets two distinct codes",
  findLga("LA-SURULERE") !== null && findLga("OY-SURULERE") !== null,
  [findLga("LA-SURULERE"), findLga("OY-SURULERE")]
);

/* ── Lookups ──────────────────────────────────────────────────── */

check("a state is found by code", findState("KW")?.name === "Kwara");
check("case does not matter", findState("kw")?.name === "Kwara");
check("an unknown code finds nothing", findState("ZZ") === null);
check("and neither does an empty one", findState("") === null);

check("Ikeja is in Lagos", lgaBelongsToState("LA-IKEJA", "LA"));
// THE ONE THAT MATTERS. This is the check that stops a stale LGA
// surviving a change of state.
check("Ikeja is NOT in Kano", !lgaBelongsToState("LA-IKEJA", "KN"));
check("nonsense belongs nowhere", !lgaBelongsToState("XX-YY", "LA"));

check("Abuja resolves to the FCT", stateCodeFromName("Abuja") === "FC");
check("so does FCT", stateCodeFromName("FCT") === "FC");
check('"Kwara State" resolves to Kwara', stateCodeFromName("Kwara State") === "KW");
check("a town does not resolve to a state", stateCodeFromName("Ikeja") === null);
check("nor does an empty string", stateCodeFromName("") === null);

/* ── What "complete" means ────────────────────────────────────── */

const good = {
  street: "14 Unity Road, Tanke, beside the filling station",
  stateCode: "KW",
  lgaCode: "KW-ILORIN-SOUTH",
  city: "Ilorin",
};

check("a full address passes", isAddressComplete(good));
check("an empty one does not", !isAddressComplete(EMPTY_ADDRESS));

// EACH PART ON ITS OWN. Three quarters of an address is not an
// address, and the reason this is checked field by field is that
// "your address is incomplete" does not tell anybody which box.
check(
  "no street is reported against the street",
  Boolean(validateResidentialAddress({ ...good, street: "" }).street)
);
check(
  "no state is reported against the state",
  Boolean(validateResidentialAddress({ ...good, stateCode: "" }).stateCode)
);
check(
  "no LGA is reported against the LGA",
  Boolean(validateResidentialAddress({ ...good, lgaCode: "" }).lgaCode)
);
check(
  "no city is reported against the city",
  Boolean(validateResidentialAddress({ ...good, city: "" }).city)
);

// THE REPORTED BEHAVIOUR: people typed a state name into the address
// box. All three of these were real.
for (const vague of ["Lagos", "Abuja", "Ilorin"]) {
  check(
    `"${vague}" is not accepted as a street address`,
    Boolean(validateResidentialAddress({ ...good, street: vague }).street),
    vague
  );
}
check(
  "but a real short address is",
  !validateResidentialAddress({ ...good, street: "5 Bank Road, Ilorin" }).street
);

// Reachable by a stale value or a hand-written API call, not by the
// form — which is exactly why it is checked here as well.
check(
  "an LGA from the wrong state is refused",
  Boolean(validateResidentialAddress({ ...good, stateCode: "LA" }).lgaCode)
);

/* ── To the database and back ─────────────────────────────────── */

const columns = addressToColumns(good);
check("the state name is derived, not trusted", columns.residential_state_name === "Kwara");
check("so is the LGA name", columns.residential_lga_name === "Ilorin South");
check("the code is stored beside it", columns.residential_state_code === "KW");
check("the street is trimmed", addressToColumns({ ...good, street: `  ${good.street}  ` }).residential_street_address === good.street);

const roundTripped = addressFromRow(columns);
check(
  "a stored row reads back as what was entered",
  roundTripped.street === good.street &&
    roundTripped.stateCode === "KW" &&
    roundTripped.lgaCode === "KW-ILORIN-SOUTH" &&
    roundTripped.city === "Ilorin",
  roundTripped
);
check("a missing row reads as empty", addressFromRow(null).stateCode === "");

/* ── The labels, which must match the SQL ─────────────────────── */

// residential_address_missing() in migration 042 returns exactly
// these strings in exactly this order, and residential_address_
// scenarios.sql asserts it there. If the two ever drift, the KYC gate
// and the admin screen start naming different fields.
check(
  "nothing missing from a complete row",
  storedAddressMissing(columns).length === 0
);
check(
  "all four are named, in the order the form asks",
  JSON.stringify(storedAddressMissing(null)) ===
    JSON.stringify([
      "Street name and full residential address",
      "State of residence",
      "Local government area",
      "City or town",
    ]),
  storedAddressMissing(null)
);
check(
  "a stored row with a name but no code is still incomplete",
  storedAddressMissing({ ...columns, residential_state_code: null }).includes(
    "State of residence"
  )
);
check(
  "and a short street counts as missing, not merely poor",
  storedAddressMissing({ ...columns, residential_street_address: "Lagos" }).includes(
    "Street name and full residential address"
  )
);

/* ── How it prints ────────────────────────────────────────────── */

check(
  "the printed line reads as an address",
  formatStructuredAddress({
    street: "14 Unity Road, Tanke",
    city: "Ilorin",
    lgaName: "Ilorin South",
    stateName: "Kwara",
  }) === "14 Unity Road, Tanke, Ilorin, Ilorin South LGA, Kwara"
);
check(
  "and a missing part leaves no stray comma",
  formatStructuredAddress({
    street: "14 Unity Road",
    city: null,
    lgaName: null,
    stateName: "Kwara",
  }) === "14 Unity Road, Kwara"
);

console.log(
  failures === 0 ? "\nALL RESIDENTIAL ADDRESS TESTS PASSED" : `\n${failures} FAILED`
);
process.exit(failures === 0 ? 0 : 1);
