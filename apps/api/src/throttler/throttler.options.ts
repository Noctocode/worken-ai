import {
  seconds,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import type { Request } from 'express';

/**
 * Rate-limit definitions for the public password-auth endpoints.
 *
 * Each endpoint is protected on two dimensions (per-IP and per-email)
 * with independent windows, so a single named throttler can't express
 * an endpoint on its own — see `throttle-auth.decorators.ts`, which
 * opts each handler into exactly the names it needs. Every value here
 * is env-overridable (limit + ttl in seconds) with the defaults agreed
 * in issue #23.
 *
 * NOTE: ttl is milliseconds in @nestjs/throttler v6, so env is read as
 * seconds and wrapped in `seconds()`.
 */

const num = (key: string, fallback: number): number => {
  const raw = process.env[key];
  if (raw == null || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** Client IP. Uses `req.ip` (resolved via `trust proxy`, set in main.ts)
 *  rather than `req.ips[0]` — the latter is the left-most X-Forwarded-For
 *  entry, which a client can spoof. `req.ip` counts trusted hops from the
 *  right, so it stays the real caller behind Cloudflare + Caddy. */
const ipTracker = (req: Request): string => req.ip ?? 'unknown';

/** Normalized email from the request body, falling back to IP when it's
 *  missing (those requests 400 anyway, but this stops a flood of empty
 *  bodies from sharing one unbounded bucket). */
const emailTracker = (req: Request): string => {
  const email = (req.body as { email?: unknown })?.email;
  if (typeof email === 'string' && email.trim()) {
    return `email:${email.trim().toLowerCase()}`;
  }
  return ipTracker(req);
};

/** Every named throttler, in one place so the decorators can opt in by
 *  name and skip the rest. */
export const THROTTLER_NAMES = {
  loginIp: 'auth-login-ip',
  loginEmail: 'auth-login-email',
  signupIpMin: 'auth-signup-ip-min',
  signupIpDay: 'auth-signup-ip-day',
  resendEmail: 'auth-resend-email',
  resendIp: 'auth-resend-ip',
  forgotEmail: 'auth-forgot-email',
  forgotIp: 'auth-forgot-ip',
} as const;

export const ALL_THROTTLER_NAMES: string[] = Object.values(THROTTLER_NAMES);

/**
 * Bypass policy. Honors RATE_LIMIT_DISABLED only outside production, so
 * an accidental flag in a prod env file can never silently drop the
 * protection (prod guard). Defaults to OFF — unset means limits apply.
 */
export const rateLimitBypassed = (): boolean =>
  process.env.RATE_LIMIT_DISABLED === 'true' &&
  process.env.NODE_ENV !== 'production';

/**
 * Build the module options. `storage` is injected (Redis) in the app;
 * tests omit it so the throttler falls back to its in-memory store.
 */
export function buildThrottlerOptions(
  storage?: ThrottlerStorage,
): ThrottlerModuleOptions {
  const N = THROTTLER_NAMES;
  return {
    ...(storage ? { storage } : {}),
    skipIf: () => rateLimitBypassed(),
    throttlers: [
      {
        name: N.loginIp,
        ttl: seconds(num('RL_LOGIN_IP_TTL', 60)),
        limit: num('RL_LOGIN_IP_LIMIT', 5),
        getTracker: ipTracker,
      },
      {
        name: N.loginEmail,
        ttl: seconds(num('RL_LOGIN_EMAIL_TTL', 3600)),
        limit: num('RL_LOGIN_EMAIL_LIMIT', 10),
        getTracker: emailTracker,
      },
      {
        name: N.signupIpMin,
        ttl: seconds(num('RL_SIGNUP_IP_MIN_TTL', 60)),
        limit: num('RL_SIGNUP_IP_MIN_LIMIT', 3),
        getTracker: ipTracker,
      },
      {
        name: N.signupIpDay,
        ttl: seconds(num('RL_SIGNUP_IP_DAY_TTL', 86400)),
        limit: num('RL_SIGNUP_IP_DAY_LIMIT', 20),
        getTracker: ipTracker,
      },
      {
        name: N.resendEmail,
        ttl: seconds(num('RL_RESEND_EMAIL_TTL', 3600)),
        limit: num('RL_RESEND_EMAIL_LIMIT', 3),
        getTracker: emailTracker,
      },
      {
        name: N.resendIp,
        ttl: seconds(num('RL_RESEND_IP_TTL', 3600)),
        limit: num('RL_RESEND_IP_LIMIT', 10),
        getTracker: ipTracker,
      },
      {
        name: N.forgotEmail,
        ttl: seconds(num('RL_FORGOT_EMAIL_TTL', 3600)),
        limit: num('RL_FORGOT_EMAIL_LIMIT', 3),
        getTracker: emailTracker,
      },
      {
        name: N.forgotIp,
        ttl: seconds(num('RL_FORGOT_IP_TTL', 3600)),
        limit: num('RL_FORGOT_IP_LIMIT', 10),
        getTracker: ipTracker,
      },
    ],
  };
}
