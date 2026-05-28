#!/usr/bin/env node
// Health check for the SharePoint (Microsoft Graph) integration's
// developer setup.
//
// Run via `pnpm setup:sharepoint` from the repo root. Verifies:
//   1. Every env var the SharePoint flow needs is present in `.env`
//      and shape-checks against Azure / Microsoft conventions (catches
//      typos like a half-pasted Client ID, or "common" mistyped as
//      "comon", before they surface as cryptic AADSTS errors).
//   2. The Microsoft identity OIDC discovery doc for the configured
//      tenant is reachable — confirms the tenant id is valid AND that
//      the dev machine can reach login.microsoftonline.com.
//   3. The API is reachable on localhost and the /sharepoint/status
//      route is mounted (probed with no auth cookie — a 401 response
//      is the pass condition).
//   4. The exact redirect URI the API will tell Microsoft to use is
//      printed so you can compare it character-for-character against
//      what's registered in Azure (#1 cause of AADSTS50011
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
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  const hash = value.indexOf(' #');
  if (hash !== -1) value = value.slice(0, hash).trim();
  env[key] = value;
}

console.log(`${C.bold}Checking .env at ${envPath}${C.reset}\n`);

let problems = 0;

// ──────────────────────────────────────────────────────────────────
// 2. Shape checks
// ──────────────────────────────────────────────────────────────────

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const clientId = env.MICROSOFT_CLIENT_ID ?? '';
if (!clientId) {
  fail(
    'MICROSOFT_CLIENT_ID is empty',
    'Azure → App registrations → your app → "Application (client) ID" (GUID at the top of the Overview blade).',
  );
  problems++;
} else if (!GUID_RE.test(clientId)) {
  fail(
    'MICROSOFT_CLIENT_ID is not a GUID',
    'Expected the "Application (client) ID" — not the Object ID. Both look like GUIDs; double-check on the Overview blade.',
  );
  problems++;
} else {
  pass(`MICROSOFT_CLIENT_ID set (${clientId})`);
}

const clientSecret = env.MICROSOFT_CLIENT_SECRET ?? '';
if (!clientSecret) {
  fail(
    'MICROSOFT_CLIENT_SECRET is empty',
    'Azure → App registrations → your app → Certificates & secrets → New client secret. Copy the VALUE column (not the Secret ID).',
  );
  problems++;
} else if (clientSecret.length < 20) {
  fail(
    `MICROSOFT_CLIENT_SECRET looks too short (${clientSecret.length} chars)`,
    'Azure client secret values are 30+ chars. If yours is short, you likely copied the Secret ID by mistake — re-copy the VALUE column within 10 minutes of generation.',
  );
  problems++;
} else {
  pass(`MICROSOFT_CLIENT_SECRET set (${clientSecret.slice(0, 6)}…)`);
}

const tenantId = env.MICROSOFT_TENANT_ID ?? '';
let tenantOk = false;
if (!tenantId) {
  fail(
    'MICROSOFT_TENANT_ID is empty',
    'Use `common` for multi-tenant, `organizations` for work/school only, or paste your tenant GUID for single-tenant.',
  );
  problems++;
} else if (
  tenantId === 'common' ||
  tenantId === 'organizations' ||
  tenantId === 'consumers' ||
  GUID_RE.test(tenantId)
) {
  pass(`MICROSOFT_TENANT_ID = ${tenantId}`);
  tenantOk = true;
} else {
  fail(
    `MICROSOFT_TENANT_ID = "${tenantId}" is not recognised`,
    'Allowed values: `common`, `organizations`, `consumers`, or a tenant GUID. Anything else fails at the Microsoft authorize endpoint with AADSTS90002.',
  );
  problems++;
}

const spRedirect =
  env.SHAREPOINT_REDIRECT_URI ||
  'http://localhost:3001/sharepoint/callback';
if (spRedirect !== 'http://localhost:3001/sharepoint/callback') {
  info(
    `SHAREPOINT_REDIRECT_URI overridden: ${spRedirect}\n  Make sure this URI is in your Azure app's "Redirect URIs" (Web platform).`,
  );
} else {
  pass(`SHAREPOINT_REDIRECT_URI = ${spRedirect}`);
}

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
// 3. Print the redirect URI for Azure copy-paste
// ──────────────────────────────────────────────────────────────────
console.log(`${C.bold}Redirect URI to register in Azure${C.reset}`);
console.log(`${C.dim}App registrations → your app → Authentication → Platform configurations → Web → Redirect URIs${C.reset}`);
console.log(`  ${C.yellow}${spRedirect}${C.reset}\n`);

// ──────────────────────────────────────────────────────────────────
// 4. Ping the Microsoft OIDC discovery doc for the tenant
//
// This validates the tenant id AND the dev machine's connectivity
// to login.microsoftonline.com in one round-trip. A 200 with the
// expected `issuer` field is the pass condition.
// ──────────────────────────────────────────────────────────────────
if (tenantOk) {
  const oidcUrl = `https://login.microsoftonline.com/${tenantId}/v2.0/.well-known/openid-configuration`;
  process.stdout.write(`Probing ${oidcUrl} … `);
  try {
    const res = await fetch(oidcUrl, { method: 'GET' });
    if (res.status === 200) {
      const body = await res.json().catch(() => ({}));
      if (typeof body.issuer === 'string' && body.issuer.includes('login.microsoftonline.com')) {
        console.log(`${C.green}200${C.reset}`);
        pass(`Microsoft identity platform reachable — tenant "${tenantId}" resolves to ${body.issuer}`);
      } else {
        console.log(`${C.yellow}200 (unexpected body)${C.reset}`);
        fail('OIDC discovery returned 200 but no `issuer` field — re-check tenant id');
        problems++;
      }
    } else {
      console.log(`${C.red}${res.status}${C.reset}`);
      fail(
        `OIDC discovery returned ${res.status} for tenant "${tenantId}"`,
        'For a GUID tenant, this usually means the tenant does not exist or is in a different cloud (e.g. Azure Government). For `common`, the dev machine probably cannot reach login.microsoftonline.com.',
      );
      problems++;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`${C.red}error${C.reset}`);
    fail(`Cannot reach login.microsoftonline.com — ${msg}`);
    problems++;
  }
}

// ──────────────────────────────────────────────────────────────────
// 5. Live probe of the API's /sharepoint/status route
// ──────────────────────────────────────────────────────────────────
const apiUrl = env.API_URL || 'http://localhost:3001';
const probeUrl = `${apiUrl}/sharepoint/status`;
process.stdout.write(`Probing ${probeUrl} … `);

try {
  const res = await fetch(probeUrl, { method: 'GET' });
  if (res.status === 401) {
    console.log(`${C.green}401 (expected — API + route OK)${C.reset}`);
    pass('API is reachable and /sharepoint/status is mounted');
  } else if (res.status === 200) {
    console.log(`${C.green}200 (also OK)${C.reset}`);
    pass('API is reachable and /sharepoint/status returned data');
  } else if (res.status === 500) {
    const body = await res.text().catch(() => '<no body>');
    console.log(`${C.red}500${C.reset}`);
    fail(
      'API errored on /sharepoint/status — usually a missing env var on startup',
      `Body: ${body.slice(0, 200)}`,
    );
    problems++;
  } else if (res.status === 404) {
    console.log(`${C.red}404${C.reset}`);
    fail(
      'API responded 404 — the SharePoint module is not wired into app.module.ts',
      'Check apps/api/src/app.module.ts imports include SharePointModule.',
    );
    problems++;
  } else {
    console.log(`${C.yellow}${res.status}${C.reset}`);
    fail(
      `Unexpected status ${res.status} from /sharepoint/status`,
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
// 6. Verdict
// ──────────────────────────────────────────────────────────────────
if (problems === 0) {
  console.log(
    `${C.green}${C.bold}OK — SharePoint setup looks healthy.${C.reset}\n` +
      `${C.dim}Next: open ${env.FRONTEND_URL || 'http://localhost:3000'}/knowledge-core and click "Connect SharePoint".${C.reset}`,
  );
  process.exit(0);
}

console.log(
  `${C.red}${C.bold}${problems} problem${problems === 1 ? '' : 's'} found.${C.reset}\n` +
    `${C.dim}Full walkthrough: docs/sharepoint-setup.md${C.reset}`,
);
process.exit(1);
