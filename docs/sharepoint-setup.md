# SharePoint integration — developer setup

End users click "Connect SharePoint" in `/knowledge-core` and Microsoft
takes it from there. **What you, the developer, do once per
environment** is wire up the Azure App registration so Microsoft knows
our app exists. This page is that one-time setup.

> If you just want to verify a setup you've already done, run
> `pnpm setup:sharepoint` — it shape-checks `.env`, pings Microsoft's
> identity discovery endpoint, and probes the API. It tells you
> exactly what's missing.

---

## What you need

- An Azure account with permission to create App registrations (free
  tier is fine). Personal Microsoft accounts work — you don't need a
  paid Azure subscription, just access to <https://portal.azure.com>.
- 5–10 minutes the first time, ~1 minute when you re-do it for prod.
- Your `worken-ai` checkout running locally with `pnpm dev:api` on
  port 3001 (or your prod API host if you're setting up prod).

## The 5-step setup

### 1. Create the App registration

Open <https://portal.azure.com> → **Microsoft Entra ID** (formerly
Azure AD) → **App registrations** in the left sidebar → **+ New
registration** at the top.

Fill in the form:

- **Name**: `worken-ai-dev` for local, `worken-ai` for prod. This is
  shown to users on the consent screen.
- **Supported account types**:
  - For **multi-tenant** (any work/school/personal Microsoft account
    can sign in): pick *"Accounts in any organizational directory…
    and personal Microsoft accounts"*.
  - For **single-tenant** (only your company's users): pick *"Accounts
    in this organizational directory only"*.
- **Redirect URI**:
  - Platform: **Web**.
  - URI: `http://localhost:3001/sharepoint/callback` for dev, or
    `https://api.YOURDOMAIN/sharepoint/callback` for prod.
- Click **Register**.

After registration, copy the **Application (client) ID** from the
Overview blade — that's your `MICROSOFT_CLIENT_ID`. Also copy the
**Directory (tenant) ID** — that's the GUID you'd use for
single-tenant `MICROSOFT_TENANT_ID`.

### 1b. Add the OneDrive redirect URI (same app)

OneDrive uses the **same Azure App registration** as SharePoint —
same client ID, same client secret, same API permissions. The only
extra setup step is registering a second redirect URI for the
OneDrive callback.

In the same App registration:
- Left sidebar → **Authentication** → **Platform configurations** →
  the **Web** platform you set up above → **Add URI**:
  - `http://localhost:3001/onedrive/callback` for dev, or
  - `https://api.YOURDOMAIN/onedrive/callback` for prod.
- Click **Save** at the top of the page.

The Authentication blade should now list BOTH redirect URIs under
Web. That's it for OneDrive — no new permissions, no new client
secret, no new admin consent (the `Files.Read.All` you already
granted covers OneDrive too).

### 2. Configure API permissions

Still inside your app registration: left sidebar → **API permissions**
→ **+ Add a permission** → **Microsoft Graph** → **Delegated
permissions** → tick all four:

- `Files.Read.All`  — read all files the signed-in user has access to.
- `Sites.Read.All`  — read all SharePoint sites the user can access.
- `User.Read`       — read the signed-in user's profile (used to
  display "Connected as petra@…").
- `offline_access`  — issue a refresh token so the integration
  survives past the 1-hour access-token lifetime.

Click **Add permissions**.

**`Sites.Read.All` needs admin consent in most tenants.** After adding
it, the API permissions blade shows "Not granted for {tenant}" in red.
Click **Grant admin consent for {tenant}** at the top — if you're a
tenant admin this completes immediately; otherwise ask your tenant
admin to do it. (Personal Microsoft accounts don't need this step.)

> Without admin consent, users will hit `AADSTS65001` on the consent
> screen the moment they click "Connect SharePoint" — the OAuth flow
> never lets them check the boxes themselves for admin-level scopes.

### 3. Create a client secret

Left sidebar → **Certificates & secrets** → **+ New client secret**.

- **Description**: `worken-ai dev` (or whatever).
- **Expires**: 180 days is fine for dev; pick 24 months for prod (or
  whatever your security policy says).
- Click **Add**.

Azure shows the secret value **only once** on this screen. Copy the
**Value** column (NOT "Secret ID" — that's a separate identifier).
Save it somewhere safe immediately. If you close the blade without
copying, you'll have to delete the secret and create a new one — there
is no "show again".

### 4. Wire credentials into `.env`

In your repo's root `.env` (not `.env.example`):

```bash
MICROSOFT_CLIENT_ID=<paste the GUID from Application (client) ID>
MICROSOFT_CLIENT_SECRET=<paste the secret VALUE from step 3>
MICROSOFT_TENANT_ID=common
SHAREPOINT_REDIRECT_URI=http://localhost:3001/sharepoint/callback
ONEDRIVE_REDIRECT_URI=http://localhost:3001/onedrive/callback
```

#### Choosing `MICROSOFT_TENANT_ID`

This controls which Microsoft endpoint we send users to and which
account types are allowed:

| Value           | Account types accepted                          | When to use                                                                                  |
| --------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `common`        | Work, school, and personal Microsoft accounts   | Default for multi-tenant apps. Easiest in dev.                                               |
| `organizations` | Work and school only (no personal MS accounts)  | Pick this if your app is for businesses only.                                                |
| `consumers`     | Personal Microsoft accounts only                | Rare — you almost never want this.                                                           |
| `<tenant GUID>` | Just that one tenant                            | Single-tenant apps, **or** when `common` is blocked by tenant policy (see below).            |

**When to use the GUID instead of `common`**: some enterprise tenants
configure Conditional Access policies that reject `common` endpoint
traffic on the "user must be from a known tenant" grounds. If you see
any of these errors at consent, switch to the tenant's GUID
(Azure → Tenant Properties → Tenant ID):

- `AADSTS50194` — "Your organization requires you to sign in with…"
- `AADSTS50020` — "User account from identity provider does not exist
  in tenant".
- `AADSTS500011` (the service principal namespace ones) at first run
  on a tenant where admin consent hasn't been granted.

Single-tenant + admin-consented is the most predictable production
config; `common` is the most permissive but most surprise-prone.

While you're in `.env`, sanity-check these too (the SharePoint flow
depends on them):

```bash
OPENROUTER_ENCRYPTION_KEY=<64 hex chars; encrypts SharePoint refresh tokens>
JWT_SECRET=<used to sign the OAuth state JWT for CSRF protection>
```

### 5. Verify

Restart your API (`pnpm dev:api`) — `.env` is only read at startup.

Then from the repo root:

```
pnpm setup:sharepoint
```

This no-deps Node script:

- Shape-checks every required env var.
- Pings Microsoft's OIDC discovery doc for your tenant — confirms the
  tenant id is valid and that the dev machine can reach
  `login.microsoftonline.com`.
- Prints the exact redirect URI the API will tell Microsoft to use,
  for character-by-character comparison against step 1.
- Pings `/sharepoint/status` on the API — a 401 response means
  the API is running and the route is mounted (the 401 is just because
  the script has no auth cookie). A 404 means SharePointModule isn't
  wired into `app.module.ts`.

If it prints `OK — SharePoint setup looks healthy`, you're done. Log
into the app, open `/knowledge-core`, click **Connect SharePoint**,
and walk through the consent screen.

---

## When you ship to production

You DON'T need a new App registration for prod. Same app, just add
the prod redirect URI alongside the dev one (step 1's Redirect URI
section — Authentication blade → Add URI).

What you DO need:

1. **A separate client secret per environment.** Don't share secrets
   between dev and prod — rotate one without rotating the other.
2. **Admin consent already in place** for `Sites.Read.All` in the prod
   tenant (step 2's note). Without it, every prod user hits the same
   `AADSTS65001` wall.
3. **Set the prod env vars**: same `MICROSOFT_CLIENT_ID`, separate
   `MICROSOFT_CLIENT_SECRET`, the prod-appropriate
   `MICROSOFT_TENANT_ID`, and prod `SHAREPOINT_REDIRECT_URI` +
   `ONEDRIVE_REDIRECT_URI`.

---

## Troubleshooting

### `AADSTS50011: The reply URL specified in the request does not match the reply URLs configured for the application`

What Microsoft saw: a `redirect_uri` that isn't on the app's Web
Redirect URIs list.

Fix: Azure → your app → Authentication → Web → Redirect URIs.
Verify the URI is there **byte-for-byte**. Common typos:

- `http://` vs `https://` (dev is plain http)
- `localhost` vs `127.0.0.1` (must be `localhost`)
- Port `3001` (API), **not** `3000` (FE)
- No trailing `/`

### `AADSTS65001: The user or administrator has not consented to use the application`

`Sites.Read.All` is configured but admin consent hasn't been granted.

Fix: Azure → your app → API permissions → **Grant admin consent for
{tenant}** at the top. If the button is disabled, you're not a tenant
admin — ask one to click it.

### `AADSTS50194` or `AADSTS50020` on first consent

Tenant policy blocks the `common` endpoint. Switch
`MICROSOFT_TENANT_ID` from `common` to your tenant GUID
(Azure → Tenant Properties → Tenant ID).

### `AADSTS7000218: The request body must contain the following parameter: 'client_assertion' or 'client_secret'`

`MICROSOFT_CLIENT_SECRET` is empty or the wrong field was copied from
Azure (the **Secret ID** instead of the **Value**). The Value column
is 30+ chars and only visible at creation time.

### `pnpm setup:sharepoint` fails on "API not reachable"

The script pings `http://localhost:3001/sharepoint/status`. If you
see `ECONNREFUSED`, the API isn't running — `pnpm dev:api` in another
terminal.

If you see `404`, the API is up but `SharePointModule` isn't wired
into `app.module.ts`. If you see `500`, the API booted but errored on
the route — usually a missing env var.

---

## Related files

- `apps/api/src/sharepoint/sharepoint-oauth.service.ts` — consent-URL
  builder + token refresh + scope verification on every refresh.
- `apps/api/src/sharepoint/sharepoint-graph.service.ts` — Microsoft
  Graph API wrapper (list sites / drives / folders, download files).
- `apps/web/src/components/sharepoint-section.tsx` — the UI block in
  `/knowledge-core`.
- `scripts/setup-sharepoint.mjs` — the `pnpm setup:sharepoint` health
  check this doc points at.
