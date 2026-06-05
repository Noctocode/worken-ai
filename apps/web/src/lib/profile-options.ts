import type { TranslationKey } from "@/lib/translations/en";

/**
 * Shared source of truth for the company-profile dropdown options
 * (industry + team size). Both the Company tab editor and the Account
 * tab read-only view render these, so they must agree on the value↔︎
 * label mapping — otherwise a stored enum like "technology" shows as a
 * localized label in one place and the raw value in the other. The BE
 * validates against the same `value` set (setup-profile/step-2).
 */
export function buildIndustries(t: (key: TranslationKey) => string) {
  return [
    { value: "technology", label: t("mgmt.company.industry.technology") },
    { value: "finance", label: t("mgmt.company.industry.finance") },
    { value: "healthcare", label: t("mgmt.company.industry.healthcare") },
    { value: "government", label: t("mgmt.company.industry.government") },
    { value: "manufacturing", label: t("mgmt.company.industry.manufacturing") },
    { value: "retail", label: t("mgmt.company.industry.retail") },
    { value: "other", label: t("mgmt.company.industry.other") },
  ];
}

export const TEAM_SIZES = [
  { value: "1-10", label: "1 – 10" },
  { value: "11-50", label: "11 – 50" },
  { value: "51-200", label: "51 – 200" },
  { value: "201-1000", label: "201 – 1,000" },
  { value: "1000+", label: "1,000+" },
];

/**
 * Resolve a stored option `value` to its display label, falling back to
 * the raw value for anything not in the catalog (e.g. a legacy / future
 * enum the FE doesn't know yet) rather than rendering blank.
 */
export const labelFor = (
  options: Array<{ value: string; label: string }>,
  value: string | null,
) => options.find((o) => o.value === value)?.label ?? value;
