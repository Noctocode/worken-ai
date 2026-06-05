import type { TranslationKey } from "@/lib/translations/en";

export type GuardrailSeverity = "high" | "medium" | "low";

const SEVERITY_KEY: Record<GuardrailSeverity, TranslationKey> = {
  high: "guardrails.high",
  medium: "guardrails.medium",
  low: "guardrails.low",
};

/**
 * Localized label for a guardrail severity. The value is a stored enum
 * ("high" | "medium" | "low") that several surfaces (guardrails list,
 * company tab, team detail, observability) rendered raw — this is the
 * single source of truth so they never drift. Case-insensitive, and
 * falls back to the raw value (or "—" for null) for anything outside
 * the known set rather than rendering blank.
 */
export function severityLabel(
  severity: string | null | undefined,
  t: (key: TranslationKey) => string,
): string {
  if (!severity) return "—";
  const key = SEVERITY_KEY[severity.toLowerCase() as GuardrailSeverity];
  return key ? t(key) : severity;
}
