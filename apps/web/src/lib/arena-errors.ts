import { MODEL_LABELS } from "./models";

function modelLabel(id: string | undefined): string | null {
  if (!id) return null;
  return MODEL_LABELS[id] ?? id;
}

export function humanizeArenaError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();

  if (typeof console !== "undefined") {
    console.error("[arena]", raw);
  }

  const modelMatch = raw.match(/for model "([^"]+)"/);
  const modelName = modelLabel(modelMatch?.[1]);
  const withModel = (tpl: (name: string) => string): string =>
    modelName ? tpl(modelName) : tpl("One of the selected models");

  if (
    lower.includes("context_length") ||
    lower.includes("context length") ||
    lower.includes("maximum context") ||
    (lower.includes("token") && /(exceed|limit|too long)/.test(lower))
  ) {
    return withModel(
      (m) =>
        `Your prompt together with the attached file is too long for ${m}. Try a shorter prompt or a smaller attachment.`,
    );
  }

  if (
    lower.includes("rate-limited") ||
    lower.includes("rate limit") ||
    /\b429\b/.test(raw)
  ) {
    return withModel(
      (m) => `${m} is temporarily rate-limited. Wait a moment or pick a different model.`,
    );
  }

  if (/no endpoints found/i.test(raw)) {
    return withModel(
      (m) => `${m} is no longer available on OpenRouter. Pick a different model.`,
    );
  }

  if (/\b401\b/.test(raw) || /invalid api key/i.test(raw) || /authentication/i.test(raw)) {
    return "The OpenRouter key looks invalid. Please contact an admin.";
  }

  if (
    /\b402\b/.test(raw) ||
    /insufficient (credit|balance)/i.test(raw) ||
    /payment required/i.test(raw)
  ) {
    return "OpenRouter credits have run out. Top up the account and try again.";
  }

  if (
    /openrouter key (unavailable|missing|not set)/i.test(raw) ||
    /could not obtain an openrouter key/i.test(raw) ||
    /provisioning failed/i.test(raw)
  ) {
    return "OpenRouter isn't configured on the server. Please contact an admin.";
  }

  if (/evaluator/i.test(raw)) {
    return "Couldn't score the answers — the evaluator model may be rate-limited. Please try again.";
  }

  if (/\b5\d\d\b/.test(raw) || /provider/i.test(raw)) {
    return withModel((m) => `${m}'s provider had a hiccup. Please try again.`);
  }

  if (
    /attachment upload failed/i.test(raw) ||
    /failed to parse/i.test(raw) ||
    /couldn't parse/i.test(raw) ||
    /no text (could|was) (be )?extracted/i.test(raw)
  ) {
    return "We couldn't read that attachment. The file may be scanned, image-only or corrupted.";
  }

  if (/file is too large/i.test(raw) || /\b413\b/.test(raw)) {
    return "That file is too large. Attachments are capped at 30 MB.";
  }

  if (/unsupported file type/i.test(raw)) {
    return "That file type isn't supported. Try PDF, DOCX, or a text-based file.";
  }

  return "Something went wrong. Please try again.";
}
