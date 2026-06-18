/**
 * Default chat model used when neither the request body nor the project picks
 * one. Single source of truth — referenced by both the controller (request
 * default) and the streaming service (param default) so the two can't drift.
 * A current, listed model; the user's pick overrides it, so this is not a
 * delisting risk.
 */
export const DEFAULT_CHAT_MODEL = 'moonshotai/kimi-k2.5';
