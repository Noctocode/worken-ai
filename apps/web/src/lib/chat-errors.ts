// Pure function: can't call useAvailableModels() here, so we display the
// raw model identifier (e.g. "openai/gpt-4o") in error messages. Callers
// that want a friendlier label can pre-process `err.message` before
// passing it in.
function modelLabel(id: string | undefined): string | null {
  if (!id) return null;
  return id;
}

/**
 * Turn a thrown chat error into a user-readable sentence. Used by both
 * the project chat (/projects/[id]) and the compare-models arena, since
 * they share the same OpenRouter failure modes.
 */
export function humanizeChatError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();

  if (typeof console !== "undefined") {
    console.error("[chat]", raw);
  }

  const modelMatch = raw.match(/for model "([^"]+)"/);
  const modelName = modelLabel(modelMatch?.[1]);
  const withModel = (tpl: (name: string) => string): string =>
    modelName ? tpl(modelName) : tpl("The selected model");

  if (
    lower.includes("context_length") ||
    lower.includes("context length") ||
    lower.includes("maximum context") ||
    (lower.includes("token") && /(exceed|limit|too long)/.test(lower))
  ) {
    return withModel(
      (m) =>
        `Your prompt is too long for ${m}. Try a shorter message, trim project context, or pick a model with a larger context window.`,
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
      (m) => `${m} is no longer available on OpenRouter. Pick a different model in the project header.`,
    );
  }

  if (/\b401\b/.test(raw) || /invalid api key/i.test(raw) || /authentication/i.test(raw)) {
    return "The OpenRouter key for this team is invalid. Please contact an admin.";
  }

  // 402 = OpenRouter monthly limit hit on the team or user key.
  // We can't tell from the error message alone whether it's a team or
  // personal budget that's exhausted, so the copy stays generic.
  if (
    /\b402\b/.test(raw) ||
    /insufficient (credit|balance)/i.test(raw) ||
    /payment required/i.test(raw) ||
    /credit limit/i.test(raw) ||
    /monthly limit/i.test(raw)
  ) {
    return "Monthly budget for this workspace is exhausted. It resets on the 1st of next month — or an admin can raise the limit in Team Management.";
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

  if (/\b404\b/.test(raw) || /model not found/i.test(raw)) {
    return withModel(
      (m) => `${m} can't be reached. Make sure the model is enabled in Models → Catalog.`,
    );
  }

  const unsupportedIdx = lower.indexOf("unsupported file type");
  if (unsupportedIdx !== -1) {
    const sentence = raw.slice(unsupportedIdx).split(/\r?\n/)[0].trim();
    return sentence || "That file type isn't allowed. Allowed: PDF, DOCX, TXT, MD, CSV, JSON, and common code/text files.";
  }

  if (/file is too large/i.test(raw) || /\b413\b/.test(raw)) {
    return "That file is too large. Attachments are capped at 30 MB.";
  }

  if (
    /attachment upload failed/i.test(raw) ||
    /failed to parse/i.test(raw) ||
    /couldn't parse/i.test(raw) ||
    /no text (could|was) (be )?extracted/i.test(raw)
  ) {
    return "We couldn't read that attachment. The file may be scanned, image-only or corrupted.";
  }

  // Plain network blip (browser couldn't reach the API at all)
  if (
    /failed to fetch/i.test(raw) ||
    /networkerror/i.test(raw) ||
    /load failed/i.test(raw)
  ) {
    return "Couldn't reach the API. Check that the server is running and your connection is alive.";
  }

  return "Something went wrong. Please try again.";
}
