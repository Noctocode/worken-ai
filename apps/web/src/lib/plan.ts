import type { TranslationKey } from "@/lib/translations/en";

export interface PlanDetails {
  label: string;
  tagline: string;
  tone: "neutral" | "primary" | "premium";
}

/**
 * Static plan catalog shared by the Account tab (badge + tagline) and
 * the Company tab (label only). The BE column is loose-typed (any
 * string) so unknown plan ids fall back to a capitalize-the-raw-string
 * render rather than crashing — anyone can ship a new plan id without
 * an FE deploy. Add an entry here when a new plan launches and its
 * marketing copy is final.
 */
export function getPlanDetails(
  plan: string,
  t: (key: TranslationKey) => string,
): PlanDetails {
  if (plan === "free") {
    return {
      label: t("mgmt.account.planFree"),
      tagline: t("mgmt.account.freeTagline"),
      tone: "neutral",
    };
  }
  return {
    label: plan
      .split(/[-_\s]+/)
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ""))
      .join(" "),
    tagline: t("mgmt.account.customPlan"),
    tone: "neutral",
  };
}
