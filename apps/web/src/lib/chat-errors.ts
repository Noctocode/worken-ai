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

  // Pending-approval check FIRST — this is a 402 too, but distinct from
  // a budget that was set and then exhausted. The BE prefixes its error
  // string with `BUDGET_PENDING_APPROVAL: <message>` when a Managed
  // Cloud user has no admin-approved budget yet. Keep this branch above
  // the generic 402 so the user gets the actionable "ask your admin"
  // message instead of "your budget is exhausted".
  //
  // Anchored on the colon-then-message shape so any future error that
  // mentions the constant by name (telemetry echo, log line surfaced to
  // FE) won't accidentally trigger this branch.
  const pendingMatch = raw.match(/BUDGET_PENDING_APPROVAL:\s*([^\r\n]+)/);
  if (pendingMatch) {
    return (
      pendingMatch[1].trim() ||
      "Your account is pending budget approval. Ask your admin to set a monthly budget in Management → Users so you can start using AI."
    );
  }

  // Per-member team caps — distinct from the team-wide budget so the
  // user gets an actionable message ("your cap" vs "team's budget").
  // Both surface as 402; markers disambiguate.
  const memberCapMatch = raw.match(/TEAM_MEMBER_CAP_REACHED:\s*([^\r\n]+)/);
  if (memberCapMatch) {
    return (
      memberCapMatch[1].trim() ||
      "Your monthly cap for this team is reached. Resets on the 1st of next month, or ask an admin to raise the cap."
    );
  }
  const suspendedMatch = raw.match(/TEAM_MEMBER_SUSPENDED:\s*([^\r\n]+)/);
  if (suspendedMatch) {
    return (
      suspendedMatch[1].trim() ||
      "Your access to this team is paused. Ask the team admin to set a non-zero monthly cap."
    );
  }

  // Team-level budget gate (our own). Distinct from OpenRouter's
  // budget-exhausted hit below — this fires for BYOK / Custom routes
  // too, where OpenRouter doesn't see the call. Lets the user know
  // the *team* is over, not the workspace as a whole.
  const teamBudgetMatch = raw.match(/TEAM_BUDGET_EXCEEDED:\s*([^\r\n]+)/);
  if (teamBudgetMatch) {
    return (
      teamBudgetMatch[1].trim() ||
      "Your team's monthly budget is reached. Resets on the 1st of next month, or ask an admin to raise the team's Monthly Budget."
    );
  }
  const teamSuspendedMatch = raw.match(/TEAM_SUSPENDED:\s*([^\r\n]+)/);
  if (teamSuspendedMatch) {
    return (
      teamSuspendedMatch[1].trim() ||
      "This team is suspended (budget set to $0). Ask an admin to raise the team's Monthly Budget."
    );
  }

  // Org-wide monthly budget. Fires after per-team / per-member caps
  // pass — the call would tip the *company* over its admin-set
  // target. Different message than the workspace-budget-exhausted
  // branch below because the admin-actionable surface is different
  // (Management → Company vs. Management → Teams).
  const orgBudgetMatch = raw.match(/ORG_BUDGET_EXCEEDED:\s*([^\r\n]+)/);
  if (orgBudgetMatch) {
    return (
      orgBudgetMatch[1].trim() ||
      "Your company's monthly AI budget is reached. Resets on the 1st of next month, or ask an admin to raise the target in Management → Company."
    );
  }
  const orgSuspendedMatch = raw.match(/ORG_SUSPENDED:\s*([^\r\n]+)/);
  if (orgSuspendedMatch) {
    return (
      orgSuspendedMatch[1].trim() ||
      "Org-wide chat is paused (Company Monthly Budget set to $0). Ask an admin to clear or raise it in Management → Company."
    );
  }

  // Guardrail block — input or output rejected by an admin-configured
  // content rule (PII detected, jailbreak phrase, custom regex). The
  // BE message already names the rule + validator, so we forward it
  // verbatim when present. Generic fallback covers stripped error
  // bodies (proxy filtered, shorter network log, etc.).
  const guardrailMatch = raw.match(/GUARDRAIL_BLOCKED:\s*([^\r\n]+)/);
  if (guardrailMatch) {
    return (
      guardrailMatch[1].trim() ||
      "A content guardrail blocked this message. Edit and try again, or ask an admin to adjust the rule in Management → Guardrails."
    );
  }

  // 402 — OpenRouter's body for budget-exhausted hits is full of
  // "max_tokens" and "total limit" wording that would otherwise false-
  // positive into the context-length branch below. The HTTP status code
  // is the most reliable signal, hence the \b402\b check here.
  if (
    /\b402\b/.test(raw) ||
    /insufficient (credit|balance)/i.test(raw) ||
    /payment required/i.test(raw) ||
    /credit limit/i.test(raw) ||
    /monthly limit/i.test(raw) ||
    /requires more credits/i.test(raw) ||
    /can only afford/i.test(raw)
  ) {
    return "Monthly budget for this workspace is exhausted. It resets on the 1st of next month — or an admin can raise the limit in Team Management.";
  }

  if (
    lower.includes("context_length") ||
    lower.includes("context length") ||
    lower.includes("context window") ||
    lower.includes("maximum context") ||
    /input.*(too long|too large)/.test(lower) ||
    /prompt.*(too long|too large)/.test(lower) ||
    /exceeds.*context/.test(lower)
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
      (m) => `${m} is no longer available in the catalog. Pick a different model in the project header.`,
    );
  }

  // Custom LLM endpoint requires an API key but none was configured.
  // BE annotates the message; pass it through verbatim so the user
  // sees "Open Management → Integration → … and add your key."
  if (/requires an API key/i.test(raw)) {
    return raw;
  }

  if (/\b401\b/.test(raw) || /invalid api key/i.test(raw) || /authentication/i.test(raw)) {
    return "The API key for this provider is invalid. Open Management → Integration, click Settings on the provider card and update it.";
  }

  if (
    // Patterns match both the new "AI gateway / AI usage key" wording
    // and the legacy "openrouter" mentions so log lines from older
    // BE deploys still humanize correctly.
    /(?:openrouter|ai gateway|ai usage) key (unavailable|missing|not set)/i.test(raw) ||
    /no (?:openrouter|ai gateway|ai usage) key available/i.test(raw) ||
    /could not obtain an? (?:openrouter|ai gateway|ai usage) key/i.test(raw) ||
    /provisioning failed/i.test(raw)
  ) {
    return "The AI gateway isn't configured on the server. Please contact an admin.";
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
