#!/usr/bin/env node
// Health check for the Google Drive integration's developer setup.
//
// Run via `pnpm setup:drive` from the repo root. Verifies that:
//   1. Every env var the Drive flow needs is present in `.env` and
//      shape-checks against Google / OpenSSL conventions (catches
//      typos like a half-pasted Client ID before they surface as
//      cryptic Google errors).
//   2. The API is reachable on localhost and the /google-drive/status
//      route is mounted (probed with no auth cookie — a 401 response
//      is the pass condition; ECONNREFUSED / 500 are the fail modes).
//   3. The exact redirect URI the API tells Google to use is printed
//      so you can compare it character-for-character against what's
//      registered in Google Cloud Console (#1 cause of
//      redirect_uri_mismatch).
//
// Exit 0 = all green, 1 = at least one check failed.
//
// No dependencies — plain Node ESM so it works without an install
// step on a fresh checkout.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const envPath = join(repoRoot, '.env');

const C = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
};

function pass(msg) {
  console.log(`${C.green}✓${C.reset} ${msg}`);
}
function fail(msg, hint) {
  console.log(`${C.red}✗${C.reset} ${msg}`);
  if (hint) console.log(`  ${C.dim}${hint}${C.reset}`);
}
function info(msg) {
  console.log(`${C.dim}${msg}${C.reset}`);
}

// ──────────────────────────────────────────────────────────────────
// 1. Parse .env
// ──────────────────────────────────────────────────────────────────
if (!existsSync(envPath)) {
  fail(
    `.env not found at ${envPath}`,
    "Copy .env.example to .env, then re-run. Don't commit .env.",
  );
  process.exit(1);
}

const env = {};
for (const rawLine of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const line = rawLine.trim();
  if (!line || line.startsWith('#')) continue;
  const eq = line.indexOf('=');
  if (eq === -1) continue;
  const key = line.slice(0, eq).trim();
  let value = line.slice(eq + 1).trim();
  // Strip surrounding quotes — `.env` shells let you quote a value.
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  // Drop trailing inline comments so a `KEY=val # comment` line
  // doesn't read "val # comment" as the value.
  const hash = value.indexOf(' #');
  if (hash !== -1) value = value.slice(0, hash).trim();
  env[key] = value;
}

console.log(`${C.bold}Checking .env at ${envPath}${C.reset}\n`);

let problems = 0;

// ──────────────────────────────────────────────────────────────────
// 2. Shape checks
// ──────────────────────────────────────────────────────────────────

// GOOGLE_CLIENT_ID: 12 digits-dash-something-.apps.googleusercontent.com
const clientId = env.GOOGLE_CLIENT_ID ?? '';
if (!clientId) {
  fail(
    'GOOGLE_CLIENT_ID is empty',
    'Get it from Google Cloud Console → APIs & Services → Credentials → your OAuth client.',
  );
  problems++;
} else if (!clientId.endsWith('.apps.googleusercontent.com')) {
  fail(
    'GOOGLE_CLIENT_ID looks malformed',
    'Expected suffix ".apps.googleusercontent.com". Did the copy-paste truncate?',
  );
  problems++;
} else {
  pass(`GOOGLE_CLIENT_ID set (${clientId.slice(0, 24)}…)`);
}

// GOOGLE_CLIENT_SECRET: starts with GOCSPX-
const clientSecret = env.GOOGLE_CLIENT_SECRET ?? '';
if (!clientSecret) {
  fail(
    'GOOGLE_CLIENT_SECRET is empty',
    'Visible on the OAuth client detail page in Cloud Console.',
  );
  problems++;
} else if (!clientSecret.startsWith('GOCSPX-')) {
  fail(
    'GOOGLE_CLIENT_SECRET looks malformed',
    'Modern Google client secrets start with "GOCSPX-". If yours doesn\'t, you may have copied the Client ID into this field by mistake.',
  );
  problems++;
} else {
  pass(`GOOGLE_CLIENT_SECRET set (${clientSecret.slice(0, 14)}…)`);
}

// GOOGLE_DRIVE_REDIRECT_URI: defaulted in code; warn if it doesn't
// match the localhost convention so a missing entry in Cloud Console
// is at least visible here too.
const driveRedirect =
  env.GOOGLE_DRIVE_REDIRECT_URI || 'http://localhost:3001/google-drive/callback';
if (driveRedirect !== 'http://localhost:3001/google-drive/callback') {
  info(
    `GOOGLE_DRIVE_REDIRECT_URI overridden: ${driveRedirect}\n  Make sure this URI is in your OAuth client's Authorized redirect URIs.`,
  );
} else {
  pass(`GOOGLE_DRIVE_REDIRECT_URI = ${driveRedirect}`);
}

// OPENROUTER_ENCRYPTION_KEY: 64 hex chars (32 bytes).
const encKey = env.OPENROUTER_ENCRYPTION_KEY ?? '';
if (!encKey) {
  fail(
    'OPENROUTER_ENCRYPTION_KEY is empty',
    'Generate with: openssl rand -hex 32',
  );
  problems++;
} else if (encKey.length !== 64 || !/^[0-9a-f]+$/i.test(encKey)) {
  fail(
    `OPENROUTER_ENCRYPTION_KEY must be exactly 64 hex chars (got ${encKey.length})`,
    'Regenerate with: openssl rand -hex 32',
  );
  problems++;
} else {
  pass('OPENROUTER_ENCRYPTION_KEY set (64 hex chars, AES-256 ready)');
}

// JWT_SECRET — used to sign the OAuth state JWT for CSRF protection.
// We don't enforce a specific format, just non-empty + reasonably
// long (a 16-char "test" secret should warn).
const jwtSecret = env.JWT_SECRET ?? '';
if (!jwtSecret) {
  fail('JWT_SECRET is empty', 'Generate with: openssl rand -hex 64');
  problems++;
} else if (jwtSecret.length < 32) {
  fail(
    `JWT_SECRET is short (${jwtSecret.length} chars)`,
    'Use at least 32 chars. Generate with: openssl rand -hex 64',
  );
  problems++;
} else {
  pass(`JWT_SECRET set (${jwtSecret.length} chars)`);
}

console.log('');

// ──────────────────────────────────────────────────────────────────
// 3. Print the redirect URI for Cloud Console copy-paste
// ──────────────────────────────────────────────────────────────────
console.log(`${C.bold}Redirect URI to register in Google Cloud Console${C.reset}`);
console.log(`${C.dim}APIs & Services → Credentials → your OAuth client → "Authorized redirect URIs"${C.reset}`);
console.log(`  ${C.yellow}${driveRedirect}${C.reset}`);
console.log(
  `  ${C.dim}(Plus ${env.GOOGLE_CALLBACK_URL || 'http://localhost:3001/auth/google/callback'} for sign-in)${C.reset}\n`,
);

// ──────────────────────────────────────────────────────────────────
// 4. Live probe of the API's /google-drive/status route
// ──────────────────────────────────────────────────────────────────
const apiUrl = env.API_URL || 'http://localhost:3001';
const probeUrl = `${apiUrl}/google-drive/status`;
process.stdout.write(`Probing ${probeUrl} … `);

try {
  const res = await fetch(probeUrl, { method: 'GET' });
  if (res.status === 401) {
    // 401 is the pass condition: API is up, route is mounted, JWT
    // guard is correctly rejecting our unauthenticated probe.
    console.log(`${C.green}401 (expected — API + route OK)${C.reset}`);
    pass('API is reachable and /google-drive/status is mounted');
  } else if (res.status === 200) {
    // Unlikely from a fresh shell process (no auth cookie), but
    // perfectly valid — e.g. someone exported a cookie. Still a pass.
    console.log(`${C.green}200 (also OK)${C.reset}`);
    pass('API is reachable and /google-drive/status returned data');
  } else if (res.status === 500) {
    const body = await res.text().catch(() => '<no body>');
    console.log(`${C.red}500${C.reset}`);
    fail(
      'API errored on /google-drive/status — usually a missing env var on startup',
      `Body: ${body.slice(0, 200)}`,
    );
    problems++;
  } else {
    console.log(`${C.yellow}${res.status}${C.reset}`);
    fail(
      `Unexpected status ${res.status} from /google-drive/status`,
      'Expected 401 (unauthenticated probe). Is the API behind an unexpected proxy?',
    );
    problems++;
  }
} catch (err) {
  console.log(`${C.red}error${C.reset}`);
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed')) {
    fail(
      `API not running at ${apiUrl}`,
      'Start it with `pnpm dev:api` in another terminal, then re-run this check.',
    );
  } else {
    fail(`Probe failed: ${msg}`);
  }
  problems++;
}

console.log('');

// ──────────────────────────────────────────────────────────────────
// 5. Verdict
// ──────────────────────────────────────────────────────────────────
if (problems === 0) {
  console.log(
    `${C.green}${C.bold}OK — Drive setup looks healthy.${C.reset}\n` +
      `${C.dim}Next: open the app at ${env.FRONTEND_URL || 'http://localhost:3000'}/knowledge-core and click "Connect Google Drive".${C.reset}`,
  );
  process.exit(0);
}

console.log(
  `${C.red}${C.bold}${problems} problem${problems === 1 ? '' : 's'} found.${C.reset}\n` +
    `${C.dim}Full walkthrough: docs/google-drive-setup.md${C.reset}`,
);
process.exit(1);
