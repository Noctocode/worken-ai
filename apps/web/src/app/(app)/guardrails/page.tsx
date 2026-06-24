import { redirect } from "next/navigation";

// Guardrails moved into Settings (Management) as a tab, right after Models.
// Keep the old /guardrails link working by redirecting to it.
export default function GuardrailsRedirect() {
  redirect("/teams?tab=guardrails");
}
