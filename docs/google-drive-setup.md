# Google Drive integration — developer setup

End users click "Connect Google Drive" in `/knowledge-core` and Google
takes it from there. **What you, the developer, do once per
environment** is wire up the Google OAuth client so Google knows our
app exists. This page is that one-time setup.

> If you just want to verify a setup you've already done, run
> `pnpm setup:drive` — it shape-checks `.env` and pings the API, and
> tells you exactly what's missing.

---

## What you need

- Access to a Google Cloud project (free tier is fine for dev).
- 5 minutes the first time, ~1 minute when you re-do it for prod.
- Your `worken-ai` checkout running locally with `pnpm dev:api` on
  port 3001 (or your prod API host if you're setting up prod).

## The 5-step setup

### 1. Create / pick a Google Cloud project

Open <https://console.cloud.google.com>. The project picker is the
dropdown at the top-left of the header bar (next to the Google Cloud
logo).

- **New tenancy**: click "New Project", give it a name (e.g.
  `worken-ai-dev` for local, `worken-ai` for prod), accept defaults,
  CREATE.
- **Existing**: just pick it from the dropdown. Sign-in and Drive
  should live on the **same** project — they share the same OAuth
  client.

### 2. Configure the OAuth consent screen

Navigate: **APIs & Services → OAuth consent screen** (in the
left-hand sidebar; if the sidebar is collapsed, click the ☰ at the
top-left of the page).

First time you hit this page, Google asks "Which user type":

- **External** — pick this unless you have a Google Workspace
  organisation and only its members will use the app.
- Click CREATE.

Fill in the consent screen form:

- **App name**: `Workenai` (or whatever — this is what users see on
  the consent dialog: "Workenai wants access to your Google Account").
- **User support email**: your email.
- **App logo**: optional in dev; required before production
  publishing (more on that below).
- **Authorized domains**: empty in dev. In prod, add the bare domain
  of your `FRONTEND_URL` / `API_URL` (e.g. `workenai.com`).
- **Developer contact**: your email.
- SAVE AND CONTINUE.

Next screen — **Scopes**:

- Click **ADD OR REMOVE SCOPES**.
- In the filter, paste:
  ```
  https://www.googleapis.com/auth/drive.readonly
  ```
- Tick the checkbox next to it, then UPDATE at the bottom of the
  modal.
- The `email` / `profile` scopes for sign-in are already covered by
  Google's default "non-sensitive" set — no action needed.
- SAVE AND CONTINUE.

Next screen — **Test users**:

- Click ADD USERS.
- Add **every email that will sign in during dev** — yours, your
  teammates'. While the app is in "Testing" mode, **only listed test
  users can complete the OAuth flow.** Anyone else gets
  "Access blocked: <App> has not completed the Google verification
  process".
- SAVE AND CONTINUE.

Review screen → BACK TO DASHBOARD.

### 3. Create the OAuth 2.0 Client

Navigate: **APIs & Services → Credentials** (left sidebar).

- Click **+ CREATE CREDENTIALS** at the top → **OAuth client ID**.
- **Application type**: `Web application`.
- **Name**: whatever — `worken-ai-dev` is fine. (This is internal,
  not shown to users.)
- **Authorized JavaScript origins**: leave empty (we don't use the
  implicit/JS flow).
- **Authorized redirect URIs**: this is the critical one. Add
  **both** redirect URIs for your environment:

  | Environment | URIs to add |
  | --- | --- |
  | **Local dev** | `http://localhost:3001/auth/google/callback` <br> `http://localhost:3001/google-drive/callback` |
  | **Production** | `https://api.YOURDOMAIN/auth/google/callback` <br> `https://api.YOURDOMAIN/google-drive/callback` |

  > A single OAuth client can hold multiple redirect URIs.
  > In practice we register all four (both envs) on the same client so
  > you don't need two clients to switch between dev and prod.

- CREATE.

A modal pops up with the Client ID and Client Secret. **Copy both
NOW** — the Secret is shown in full only once on this screen (you
can still get a copy later from the client's detail view, but it's
easier here).

### 4. Wire credentials into `.env`

In your repo's root `.env` (not `.env.example`), paste:

```bash
GOOGLE_CLIENT_ID=<paste here, ends with .apps.googleusercontent.com>
GOOGLE_CLIENT_SECRET=<paste here, starts with GOCSPX->
```

You can leave `GOOGLE_CALLBACK_URL` and `GOOGLE_DRIVE_REDIRECT_URI` at
their `localhost:3001` defaults — those are what the API tells Google
to redirect to, and they must match exactly what you registered in
step 3.

While you're in `.env`, sanity-check these too (Drive setup depends
on them):

```bash
OPENROUTER_ENCRYPTION_KEY=<64 hex chars; encrypts Drive refresh tokens>
JWT_SECRET=<used to sign the OAuth state JWT for CSRF protection>
```

### 5. Verify

Restart your API (`pnpm dev:api`) — `.env` is only read at startup.

Then from the repo root:

```
pnpm setup:drive
```

This is a no-deps Node script that:

- Shape-checks every required env var in `.env`.
- Prints the exact redirect URI the API will tell Google to use, so
  you can compare it character-for-character against what's registered
  in step 3 (the #1 cause of `redirect_uri_mismatch`).
- Pings `/google-drive/status` on the API — a 401 response is the
  pass condition (means the API is running and the route is mounted;
  the 401 is just because the script has no auth cookie).
- Exits non-zero on any failure, with an action item per failure.

If it prints `OK — Drive setup looks healthy`, you're done. Log into
the app, open `/knowledge-core`, click **Connect Google Drive**, and
walk through the consent screen.

---

## When you ship to production

You DON'T need a new OAuth client. Same client, add the prod URIs
alongside the dev ones (step 3's table).

What you DO need before letting non-test users sign up:

1. **Publish the OAuth app**: APIs & Services → OAuth consent screen →
   **PUBLISH APP** button. This flips the app from "Testing" (max 100
   test users, consent screen warns "unverified app") to "In
   production".
2. **Verify the brand** if you use sensitive scopes
   (`drive.readonly` qualifies). Google sometimes pops a verification
   request when you publish — fill in the form when prompted. For
   `drive.readonly` it's typically a quick review (~1 week).
3. **Set the prod env vars**: same `GOOGLE_CLIENT_ID` and
   `GOOGLE_CLIENT_SECRET` go in your prod env. Update
   `GOOGLE_CALLBACK_URL` + `GOOGLE_DRIVE_REDIRECT_URI` to the prod
   API host.

---

## Troubleshooting

### `Error 400: redirect_uri_mismatch`

What Google saw: a `redirect_uri` query param that isn't on the
client's "Authorized redirect URIs" list.

Fix: open the OAuth client (step 3) → "Authorized redirect URIs" →
verify the URI from the error message is there **byte-for-byte**.
Common typos:

- `http://` vs `https://` (dev is plain http)
- `localhost` vs `127.0.0.1` (must be `localhost`)
- Port `3001` (API), **not** `3000` (FE)
- No trailing `/`

After adding, click **SAVE** at the bottom of the page — without the
Save, the input is lost. Sometimes there's a few-minutes propagation
delay on Google's side.

### `Access blocked: <App> has not completed the Google verification process`

The OAuth app is in Testing mode AND your email isn't on the test
users list.

Fix: OAuth consent screen (step 2) → Test users → ADD USERS → paste
your email → SAVE. No propagation delay.

### `Access blocked: invalid_scope` (or similar scope error)

`drive.readonly` is a sensitive scope and isn't registered on your
consent screen.

Fix: OAuth consent screen (step 2) → Scopes → ADD OR REMOVE SCOPES →
filter for `drive.readonly` → tick → UPDATE → SAVE on the consent
screen page itself.

### `Access blocked: This app's request is invalid`

Catch-all message from Google when the OAuth request doesn't comply
with policy. The actual reason is in the URL of the error page as a
query parameter (look for `&error=...`):

- `error=redirect_uri_mismatch` → see the redirect_uri_mismatch
  section above.
- `error=invalid_request` → typically the OAuth client doesn't exist
  (wrong `GOOGLE_CLIENT_ID` in `.env`, or you're looking at a
  different Google Cloud project than the one that owns the client).
- `error=access_denied` → user clicked Deny on the consent screen.
  Not a setup issue; just try again.

### `pnpm setup:drive` fails on "API not reachable"

The script pings `http://localhost:3001/google-drive/status`. If you
see `ECONNREFUSED`, the API isn't running — `pnpm dev:api` in another
terminal.

If you see `500` instead of the expected `401`, the API booted but
errored on the route — usually because one of the required env vars
is missing or malformed. The script prints which one.

---

## Related files

- `apps/api/src/google-drive/google-drive-oauth.service.ts` —
  consent-URL builder + token refresh.
- `apps/api/src/google-drive/google-drive-client.service.ts` —
  Drive API wrapper (list / export / download).
- `apps/web/src/components/drive-section.tsx` — the UI block in
  `/knowledge-core`.
- `scripts/setup-drive.mjs` — the `pnpm setup:drive` health check
  this doc points at.
