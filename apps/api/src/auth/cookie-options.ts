// Cookie domain — set in prod to `.workenai.com` so the same access /
// refresh tokens are available to both `app.workenai.com` (where the
// Next.js middleware reads them server-side) and `api.workenai.com`
// (where the API authenticates them). Leave unset in dev so cookies
// stay host-only on `localhost`.
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || undefined;

/**
 * Single source of truth for the auth session cookie shape. Imported
 * by both /auth/* (set on login, clear on logout) and /onboarding/abort
 * (clear after the user row is wiped). Keeping the options in one
 * place prevents one endpoint from clearing a different cookie scope
 * than the other sets — drift there would strand a dangling
 * refresh_token pointing at a now-deleted user.
 */
export const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  domain: COOKIE_DOMAIN,
};
