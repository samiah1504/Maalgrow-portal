"use client";

/**
 * The four address fields, in the order they are asked for.
 *
 * ONE COMPONENT, THREE FORMS. The investor's KYC form, the admin's
 * new-investor form and the admin's edit form all capture the same
 * address, and a difference between them would show up as a record
 * that passes one screen and fails another. Controlled rather than
 * bound to any form library, because those three do not agree on one.
 *
 * THE LGA FOLLOWS THE STATE. Changing the state CLEARS the LGA rather
 * than leaving it: somebody who picks Lagos, chooses Ikeja, then
 * realises they meant Ogun would otherwise be left holding an Ikeja
 * that is now wrong and looks right. It is disabled until a state is
 * chosen, and says why.
 *
 * THE CITY IS TYPED, DELIBERATELY. Nigerian towns do not line up with
 * LGA boundaries — Sango Ota, Ojoo and Tanke are places people live
 * and none of them is an LGA. Offering a list would force people into
 * the nearest wrong answer, so this one is a text field.
 */

import { useMemo } from "react";
import { MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { NIGERIAN_STATES, lgasForState } from "@/lib/nigeria-geo";
import type {
  AddressFieldErrors,
  ResidentialAddressValue,
} from "@/lib/residential-address";

export function ResidentialAddressFields({
  value,
  onChange,
  errors = {},
  disabled,
  previousAddress,
}: {
  value: ResidentialAddressValue;
  onChange: (next: ResidentialAddressValue) => void;
  errors?: AddressFieldErrors;
  disabled?: boolean;
  /**
   * What they told us before the address had parts. Shown, never
   * pre-filled: it is a reminder of what they said, not an answer —
   * copying "Ilorin" into the street box is the mistake this whole
   * change exists to stop.
   */
  previousAddress?: string | null;
}) {
  const stateOptions = useMemo(
    () => NIGERIAN_STATES.map((s) => ({ value: s.code, label: s.name })),
    []
  );
  const lgaOptions = useMemo(
    () => lgasForState(value.stateCode).map((l) => ({ value: l.code, label: l.name })),
    [value.stateCode]
  );

  const set = (patch: Partial<ResidentialAddressValue>) =>
    onChange({ ...value, ...patch });

  return (
    <div className="space-y-3">
      {previousAddress && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-medium text-amber-900">
            Previous address record
          </p>
          <p className="mt-0.5 flex items-start gap-1.5 text-sm text-amber-800">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {previousAddress}
          </p>
          <p className="mt-1.5 text-xs text-amber-800/90">
            This is what we have on file. It is kept either way — please
            enter your address again in the four fields below.
          </p>
        </div>
      )}

      {/* 1 */}
      <div className="w-full space-y-1.5">
        <label className="block text-sm font-medium text-foreground">
          Street Name and Full Residential Address
          <span className="ml-0.5 text-danger">*</span>
        </label>
        <textarea
          rows={3}
          disabled={disabled}
          value={value.street}
          onChange={(e) => set({ street: e.target.value })}
          placeholder="House number, street name, estate/community and nearest landmark"
          className={[
            "flex w-full rounded-lg border bg-white px-3 py-2 text-sm text-foreground transition-colors",
            "placeholder:text-muted/60",
            "border-border focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20",
            "disabled:cursor-not-allowed disabled:bg-surface-2 disabled:opacity-60",
            errors.street ? "border-danger focus:border-danger focus:ring-danger/20" : "",
          ].join(" ")}
        />
        {errors.street ? (
          <p className="text-xs text-danger">{errors.street}</p>
        ) : (
          <p className="text-xs text-muted">
            A town or state on its own is not enough — this is the address
            printed on your tax documents.
          </p>
        )}
      </div>

      {/* 2 */}
      <SearchableSelect
        label="State of Residence"
        required
        disabled={disabled}
        options={stateOptions}
        value={value.stateCode || null}
        // Changing the state invalidates the LGA. Clearing it is the
        // only safe thing to do with it.
        onChange={(stateCode) => set({ stateCode, lgaCode: "" })}
        placeholder="Select your state"
        searchPlaceholder="Type a state name…"
        error={errors.stateCode}
      />

      {/* 3 */}
      <SearchableSelect
        label="Local Government Area"
        required
        disabled={disabled || !value.stateCode}
        disabledReason="Choose your state first"
        options={lgaOptions}
        value={value.lgaCode || null}
        onChange={(lgaCode) => set({ lgaCode })}
        placeholder="Select your local government area"
        searchPlaceholder="Type an LGA name…"
        emptyMessage="No local government area matches that"
        error={errors.lgaCode}
        hint={
          value.stateCode
            ? `${lgaOptions.length} local government area${lgaOptions.length === 1 ? "" : "s"} in this state`
            : undefined
        }
      />

      {/* 4 */}
      <Input
        label="City or Town"
        required
        disabled={disabled}
        value={value.city}
        onChange={(e) => set({ city: e.target.value })}
        placeholder="e.g. Ilorin, Sango Ota, Bodija"
        error={errors.city}
        hint={
          errors.city
            ? undefined
            : "Your town may be different from your LGA — enter where you actually live."
        }
      />
    </div>
  );
}
