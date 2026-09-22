# Hardening additions

This fork adds four protections aimed at printed QR codes, where a hijacked
short link sends real people somewhere you didn't choose.

1. **Link locking.** A locked link can't be edited or deleted, and its slug
   can't be reused, even after the link expires. The only way to change it is
   to unlock it first, which means typing the slug again. You can restrict
   unlocking to named Cloudflare Access sign-ins.
2. **Change history.** Every create, edit, delete, lock, unlock, import and
   blocked attempt is written to an append-only `link_audit` table: who, when,
   from which IP and country, and each field's old and new value. Password
   hashes are never recorded. View it from a link's menu (Change history) or
   `GET /api/link/audit`.
3. **Change alerts.** Every change is pushed to an ntfy topic or a signed JSON
   webhook. Unlocks and blocked attempts are sent at urgent priority.
4. **Destination allowlist.** Links (including app-store and per-country
   destinations) can only point at domains you list. HTTPS can be required.

## Settings

Set these as Worker variables. Mark the secret ones as encrypted.

| Variable                      | Example                                         | Purpose                                                                                                                                   |
| ----------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `NUXT_CHANGE_ALERT_URL`       | `https://ntfy.sh/your-long-random-topic`        | Where alerts are sent. Empty turns alerts off.                                                                                            |
| `NUXT_CHANGE_ALERT_FORMAT`    | `ntfy`                                          | `ntfy` for phone push, `json` for a signed webhook (default).                                                                             |
| `NUXT_CHANGE_ALERT_SECRET`    | `whsec_...` (secret)                            | Signs JSON alerts, same scheme as Sink's click webhooks.                                                                                  |
| `NUXT_CHANGE_ALERT_TOKEN`     | `tk_...` (secret)                               | Optional bearer token, e.g. for a protected ntfy topic.                                                                                   |
| `NUXT_DESTINATION_ALLOWLIST`  | `example.com.au,apps.apple.com,play.google.com` | Allowed destination hosts; each also allows its subdomains. Empty allows any.                                                             |
| `NUXT_DESTINATION_HTTPS_ONLY` | `true`                                          | Reject `http:` and other non-HTTPS destinations.                                                                                          |
| `NUXT_UNLOCK_ALLOWED_EMAILS`  | `you@example.com`                               | Only these Cloudflare Access users can unlock. The site token cannot. Needs Cloudflare Access; if Access isn't set up, nobody can unlock. |

Also set these existing Sink options so edits take effect straight away and
printed codes are never cached by phones:

| Variable                    | Value  |
| --------------------------- | ------ |
| `NUXT_REDIRECT_STATUS_CODE` | `302`  |
| `NUXT_REDIRECT_NO_STORE`    | `true` |

## Recommended Cloudflare setup

- Put Cloudflare Access in front of **both** `/dashboard` and `/api` (see
  `docs/configuration/cloudflare-access.md`, "Stricter option"), with a
  one-time-PIN or Google login and MFA.
- Use a long random `NUXT_SITE_TOKEN` and keep it in a password manager.
- Protect the Cloudflare account itself with a passkey or hardware key. Anyone
  with dashboard or D1 console access can bypass the app, including its
  history table.
- Register the short domain for several years with auto-renew and registrar
  lock turned on.

## Alerts

For ntfy, install the ntfy app, subscribe to a long, random topic name, and set
`NUXT_CHANGE_ALERT_URL` to `https://ntfy.sh/<topic>` with
`NUXT_CHANGE_ALERT_FORMAT=ntfy`. Anyone who knows a public ntfy topic can read
it, so treat the topic name as a secret, or use a protected topic with
`NUXT_CHANGE_ALERT_TOKEN`.

JSON alerts are `POST`ed with `webhook-id`, `webhook-timestamp` and (when a
secret is set) `webhook-signature` headers. The body is:

```json
{
  "id": "evt_...",
  "event": "link.edit",
  "createdAt": "2026-09-22T00:00:00.000Z",
  "data": {
    "action": "edit",
    "slug": "menu",
    "shortLink": "https://go.example.com/menu",
    "actor": "you@example.com",
    "authMethod": "access-user",
    "ip": "203.0.113.5",
    "country": "AU",
    "changes": [{ "field": "url", "from": "https://old", "to": "https://new" }],
    "summary": "By: you@example.com (access-user)\n..."
  }
}
```

Alert delivery never blocks a change. Failures are written to the Worker logs
as `change_alert.delivery.failed`.

## API

- `POST /api/link/lock` with `{ "slug": "menu", "locked": true }` locks a link.
  To unlock, send `{ "slug": "menu", "locked": false, "confirm": "menu" }`.
- `GET /api/link/audit?slug=menu&limit=50&cursor=...` returns history for one
  link, newest first. Leave out `slug` for all links.
- `locked` can be set when creating or importing a link. A normal edit can't
  change it.
- Blocked changes return `423` (locked), `422` (destination not allowed) or
  `403` (not allowed to unlock).

## Upgrading an existing Sink deployment

This adds database migration `drizzle/0005_living_ultimo.sql` (a `locked`
column and the `link_audit` table). Sink's deploy scripts apply migrations
automatically; otherwise run `pnpm db:migrate:remote`. History starts from the
moment you deploy; earlier changes aren't shown.
