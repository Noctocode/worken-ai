# Confluence (Atlassian) — Knowledge Core setup

This integration lets a user connect their Atlassian Confluence Cloud site and
import pages into Knowledge Core. It mirrors the Google Drive integration: one
OAuth connection per user (`provider='confluence'`), a browse UI for spaces and
pages, and a Re-sync flow that only pulls new pages.

Each imported page's body is fetched from Confluence, converted to Markdown, and
fed through the same chunk + embed pipeline as uploaded documents.

## 1. Create an Atlassian OAuth 2.0 (3LO) app

1. Go to <https://developer.atlassian.com/console/myapps/> and click
   **Create → OAuth 2.0 integration**. Give it a name (e.g. "WorkenAI").
2. **Permissions** → add **Confluence API**, then **Add** these scopes:
   - `read:confluence-space.summary`
   - `read:confluence-content.all`
   - `read:confluence-content.summary`
   - `read:me`

   > `offline_access` is requested automatically by the connect flow so
   > Atlassian returns a refresh token — you don't add it here.
3. **Authorization** → next to **OAuth 2.0 (3LO)** click **Configure** and set
   the **Callback URL** to:

   ```
   http://localhost:3001/confluence/callback
   ```

   Add the production equivalent (e.g. `https://api.yourapp.com/confluence/callback`)
   alongside it before you deploy.
4. **Settings** → copy the **Client ID** and **Secret**.

## 2. Configure environment variables

Add to your `.env` (see `.env.example`):

```
CONFLUENCE_CLIENT_ID=<your client id>
CONFLUENCE_CLIENT_SECRET=<your secret>
CONFLUENCE_REDIRECT_URI=http://localhost:3001/confluence/callback
```

The redirect URI must match the Callback URL registered in the Atlassian console
exactly (scheme, host, port, path).

## 3. Run the migration

```
pnpm db:migrate
```

This creates the `confluence_import_sources` table. Confluence reuses the
existing `oauth_connections` table for tokens and the `knowledge_files`
`external_id` / `external_url` columns for provenance (no new columns).

## 4. Use it

On the **Knowledge Core** page, the **Confluence** card lets the user:

- **Connect** — runs the Atlassian consent flow and stores encrypted tokens.
- **Import from Confluence** — pick a space, then either the **entire space**
  (background job with progress) or **specific pages** (each picked page is
  imported together with its child pages).
- **Re-sync** an imported source — adds only pages that appeared since the last
  sync.
- **Remove source** — stops tracking the source; already-imported pages stay.

## How it works

- **OAuth**: Atlassian 3LO. Tokens are encrypted at rest with the same
  AES-256-GCM helper used for BYOK keys. Atlassian rotates the refresh token on
  every refresh, so the new one is persisted each time. On refresh failure the
  connection flips to `reauth_required` and the UI shows a "Reconnect" prompt.
- **Site resolution**: after connecting, the API resolves the Atlassian
  `cloudId` via `accessible-resources` and caches it in memory. If the user has
  access to multiple sites, the first Confluence-scoped site is used.
- **Spaces / pages**: read through the Confluence Cloud v2 REST API
  (`/wiki/api/v2/...`) via the `api.atlassian.com/ex/confluence/{cloudId}`
  gateway.
- **Ingestion**: at ingestion time each page's `export_view` body (rendered
  HTML) is downloaded, converted to Markdown, written under
  `uploads/knowledge-core/confluence/`, and parsed by the existing Markdown
  reader.
- **Dedup**: by `(uploaded_by_id, external_id)` where `external_id` is the
  Confluence page id (unique within a site). Confluence rows leave
  `external_drive_id` NULL, so they share the Drive/OneDrive dedup index.

## Caps

- Whole-space import: up to 10,000 pages.
- Specific-pages import: up to 1,000 pages (including descendants).

Contact the maintainers if you need these raised.
