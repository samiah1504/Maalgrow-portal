/**
 * The residential address, in four parts.
 *
 * ONE DEFINITION OF "COMPLETE", SHARED BY EVERYTHING. The form uses
 * it to decide whether to submit, the API uses it to decide whether
 * to accept, and residential_address_missing() in migration 042 says
 * the same thing in SQL. Three copies of a rule is how they drift;
 * these two are kept beside each other deliberately, and the SQL one
 * is the authority — it is the one a script or a hand-written query
 * cannot get round.
 *
 * WHY THE NAMES ARE STORED TOO. The code is what joins; the name is
 * what the investor saw. A withholding tax credit note issued today
 * must still print "Yewa North" in 2031 even if the list has been
 * re-spelled since. The form only ever holds CODES — the names are
 * derived from them on the way to the database, so the two cannot
 * disagree.
 */

import {
  findLga,
  findState,
  lgaBelongsToState,
} from "./nigeria-geo";

/** What the form holds. Codes only. */
export type ResidentialAddressValue = {
  street: string;
  stateCode: string;
  lgaCode: string;
  city: string;
};

export const EMPTY_ADDRESS: ResidentialAddressValue = {
  street: "",
  stateCode: "",
  lgaCode: "",
  city: "",
};

/** The exact words an investor is shown. */
export const ADDRESS_INCOMPLETE_MESSAGE =
  "Please complete your full residential address, state, local government area and city/town before continuing.";

/**
 * Ten characters.
 *
 * Not a clever rule — it exists to refuse "Lagos", "Abuja" and
 * "Ilorin", which is what was being typed into the old single box.
 * The same number is a CHECK constraint on the column, so this is a
 * courtesy to the person filling in the form rather than the
 * enforcement.
 */
export const MIN_STREET_LENGTH = 10;

export type AddressFieldErrors = Partial<
  Record<keyof ResidentialAddressValue, string>
>;

/**
 * What is wrong with this address, field by field.
 *
 * Returns an empty object when nothing is. Per-field rather than one
 * message, because "your address is incomplete" does not tell anybody
 * which box to go back to.
 */
export function validateResidentialAddress(
  v: ResidentialAddressValue
): AddressFieldErrors {
  const errors: AddressFieldErrors = {};
  const street = v.street.trim();

  if (!street) {
    errors.street = "Enter your street name and full residential address";
  } else if (street.length < MIN_STREET_LENGTH) {
    errors.street =
      "This is too short to find you. Include the house number, street and a landmark.";
  }

  if (!v.stateCode) {
    errors.stateCode = "Select your state of residence";
  } else if (!findState(v.stateCode)) {
    errors.stateCode = "Select a state from the list";
  }

  if (!v.lgaCode) {
    errors.lgaCode = "Select your local government area";
  } else if (!findLga(v.lgaCode)) {
    errors.lgaCode = "Select a local government area from the list";
  } else if (v.stateCode && !lgaBelongsToState(v.lgaCode, v.stateCode)) {
    // Reachable only by a stale value — the form clears the LGA when
    // the state changes. The API checks it too, where the form is not
    // in the way.
    errors.lgaCode = "That local government area is not in the state you chose";
  }

  if (!v.city.trim()) {
    errors.city = "Enter your city or town";
  }

  return errors;
}

export function isAddressComplete(v: ResidentialAddressValue): boolean {
  return Object.keys(validateResidentialAddress(v)).length === 0;
}

/** The six columns, names resolved from the codes. */
export function addressToColumns(v: ResidentialAddressValue) {
  const state = findState(v.stateCode);
  const lga = findLga(v.lgaCode);
  return {
    residential_street_address: v.street.trim(),
    residential_state_code: state?.code ?? null,
    residential_state_name: state?.name ?? null,
    residential_lga_code: lga?.code ?? null,
    residential_lga_name: lga?.name ?? null,
    residential_city: v.city.trim(),
  };
}

/** Read a stored row back into what the form holds. */
export function addressFromRow(row: {
  residential_street_address?: string | null;
  residential_state_code?: string | null;
  residential_lga_code?: string | null;
  residential_city?: string | null;
} | null): ResidentialAddressValue {
  return {
    street: row?.residential_street_address ?? "",
    stateCode: row?.residential_state_code ?? "",
    lgaCode: row?.residential_lga_code ?? "",
    city: row?.residential_city ?? "",
  };
}

/**
 * Mirror of residential_address_missing() in SQL, for a stored row.
 *
 * Same labels, same order, so a screen reading this and a screen
 * reading the database say the same thing.
 */
export function storedAddressMissing(row: {
  residential_street_address?: string | null;
  residential_state_code?: string | null;
  residential_state_name?: string | null;
  residential_lga_code?: string | null;
  residential_lga_name?: string | null;
  residential_city?: string | null;
} | null): string[] {
  const filled = (v: string | null | undefined) => Boolean(v && v.trim());
  const missing: string[] = [];
  const street = row?.residential_street_address ?? "";
  if (!street.trim() || street.trim().length < MIN_STREET_LENGTH) {
    missing.push("Street name and full residential address");
  }
  if (!filled(row?.residential_state_code) || !filled(row?.residential_state_name)) {
    missing.push("State of residence");
  }
  if (!filled(row?.residential_lga_code) || !filled(row?.residential_lga_name)) {
    missing.push("Local government area");
  }
  if (!filled(row?.residential_city)) missing.push("City or town");
  return missing;
}
