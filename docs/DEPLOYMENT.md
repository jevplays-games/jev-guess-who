# Deployment and configuration

## Local runtime

The local launcher uses Node's built-in HTTP and SQLite modules. No runtime packages are installed. The shared server API consumes a narrow D1-compatible interface supplied by `scripts/sqlite-adapter.mjs` locally.

Use Node >=22.13. The actual validation runtime was Node 22.16.0 on Linux. Validate your own supported Node release before production use. SQLite was experimental in the tested runtime; an emitted warning is expected there.

```sh
npm start
```

Default binding: `127.0.0.1:8787`; canonical browser origin: `http://localhost:8787`. The origin is checked exactly. Use the canonical origin shown by the launcher rather than substituting 127.0.0.1 in the browser. When you change the port, change `ORIGIN` too.

`npm start` loads `.env` only when it exists. The local launcher generates ephemeral signing/hash secrets when they are unset. That is convenient for practice, but restarting changes those secrets and invalidates signed launch/pagination tokens and telemetry continuity. Configure stable random secrets before serious testing.

## Variables and secret handling

| Variable | Required for | Handling |
|---|---|---|
| `ORIGIN` | All HTTP routing | Exact external scheme+host+port, no trailing slash |
| `TYPESAFE_API_KEY` | Actual JEV | Server secret only |
| `JEV_MODEL` | JEV / ranked league | Default `jev-1.13.0`; use a versioned ID |
| `JEV_TIMEOUT_MS` | JEV request budget | Default 3000; bounded in code to 50–15000 |
| `JEV_INPUT_USD_PER_MILLION` | Optional cost estimate | Explicit numeric price input; empty means unknown |
| `DISCORD_CLIENT_ID` | Discord | Public configuration |
| `DISCORD_CLIENT_SECRET` | Discord OAuth/command registration | Server secret only |
| `DISCORD_PUBLIC_KEY` | Discord interactions | Public verification key from your application |
| `LAUNCH_SIGNING_KEY` | Launch and cursor signatures | At least 32 characters; generate 32 random bytes or more |
| `RATE_LIMIT_HASH_KEY` | Pseudonymous identity/IP buckets | Separate random secret; keep stable for retention analysis |
| `MATCH_RETENTION_DAYS` | Detailed logs/replays | Default 90 |
| `RESULT_RETENTION_DAYS` | Official summaries | Default 730; cannot be shorter than detailed retention in maintenance |
| `PORT`, `HOST`, `DB_PATH` | Local launcher | Defaults described in `.env.example` |

Generate each signing/hash secret independently:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Never place `.env`, `.dev.vars`, databases, credentials, or private logs inside `public/`. The generated ZIP contains none of them. The database stores active secrets and must be protected and backed up like a credential-bearing application database.

## TypeSafe / JEV

The adapter sends a bounded `Choice` request to `POST https://api.typesafe.ai/v1/systemone`, with Bearer authentication. It validates the returned model, answer type, exact option set, selected maximum-probability option, finite normalized probabilities, confidence range, and optional usage.

The provider receives public candidate masks, public question counts, legal candidate actions, computed features, and fixed instructions. It does not receive either secret, Discord identity, community metadata, random seed, or browser-supplied prose.

Pin the model ID in configuration and verify it with a live staging game. The supplied integration follows the official API documentation checked on 2026-09-22; no authenticated provider call was possible during packaging. See `SOURCES.md`.

Do not market the difficulty ordering as empirically proven until you run the live calibration harness. A model/provider change creates a different competitive configuration. Preserve old code/configurations for active matches or drain them before migration.

## Discord application

Create your own Discord application and configure:

1. OAuth redirect: `<ORIGIN>/api/auth/discord/callback`.
2. Interactions endpoint: `<ORIGIN>/api/discord/interactions`.
3. Guild installation with `applications.commands`; no bot Gateway or message-reading permission is needed by this implementation.
4. OAuth sign-in uses only `identify`.
5. Set client ID, client secret, and public verification key on the server.

Use an HTTPS staging hostname for Discord's interaction validation. Discord must be able to reach the public endpoint; a localhost URL is not a publicly reachable interactions service.

Register the command using the application's client-credentials flow:

```sh
npm run discord:register
```

This POST creates/updates the named `/play-jev` command. It does not bulk overwrite every command in the application. It supports `game: guess-who`, guild installation, and guild interaction context. No registration credential is stored in the browser.

Invoke the command in a guild channel. The ephemeral response has a link with a signed **fragment** token, which avoids ordinary HTTP query logging. The page strips it immediately and holds it transiently in session storage across OAuth. Only the invoking Discord account can redeem it, and redemption is single-use. The five-minute context lifetime begins when the interaction is issued, not when it is redeemed.

Identity and community context are different proofs. Direct website sign-in can support World-ranked play without granting private channel/server leaderboard access. Expired context requires a new `/play-jev` invocation.

## Cloudflare Workers + D1

The deployment files are supplied, but a Cloudflare deployment was not executed during packaging. Wrangler is optional deployment tooling; install a currently supported version from Cloudflare's distribution and pin the version in your own deployment lockfile after validation.

```sh
npm install --save-dev wrangler
npx wrangler login
npx wrangler d1 create jev-guess-who
```

Copy the returned database ID into `wrangler.jsonc`. Set the exact production origin and Discord public configuration. Keep the deployment's signing/hash values in secret bindings.

```sh
npx wrangler d1 migrations apply jev-guess-who --remote
npx wrangler secret put TYPESAFE_API_KEY
npx wrangler secret put DISCORD_CLIENT_SECRET
npx wrangler secret put LAUNCH_SIGNING_KEY
npx wrangler secret put RATE_LIMIT_HASH_KEY
npx wrangler deploy
```

Do not configure `LOCAL_DEVELOPMENT=true` on Workers. Without that flag, cookies use `Secure`. All requests run through the Worker so asset security headers are applied consistently. `public/` alone is bound to static assets.

The scheduled handler runs hourly, expires up to 100 overdue active matches per run, and prunes expired grants, quota buckets, sessions, detailed terminal matches, result summaries, and telemetry. Each direct match access also checks expiration. At high volume, monitor expiration backlog and increase maintenance capacity deliberately.

D1 transactions contain conditional state updates and guarded result inserts. A zero-row compare-and-swap is not treated as a transaction error; result insertion explicitly requires the same unique commit token. This is important to retain if modifying the SQL.

## Local server behind a reverse proxy

Keep the Node process bound to loopback where practical. Set `ORIGIN` to the HTTPS external origin and configure the reverse proxy to preserve the external Host. The launcher rejects a nonloopback HTTP deployment. Use a maintained service manager and an HTTPS reverse proxy of your choice; this package does not expose a public host automatically.

The Node adapter strips forwarded IP headers. It intentionally uses one local IP bucket rather than trusting arbitrary forwarded headers. For a multi-user reverse-proxy deployment, add a deliberate trusted-proxy IP configuration before treating per-IP rate limits as production-quality.

## GoDaddy Node.js hosting

The same `scripts/serve.mjs` runs as a plain Node app: `npm run build` (no-op) then `npm start` (`node --env-file-if-exists=.env scripts/serve.mjs`). In production mode it binds `0.0.0.0` (or `HOST`) on the platform-injected `PORT`. Production mode is `NODE_ENV=production` or an HTTPS `ORIGIN` with a non-loopback host, because GoDaddy's platform env may override `NODE_ENV`; loopback or HTTP origins stay local. Zip layout: repo root files (`package.json`, `server/`, `public/`, `migrations/`, `scripts/`) plus a root `.env`. Required `.env` keys: `ORIGIN` (exact HTTPS public origin), `NODE_ENV=production`, `HOST=0.0.0.0`, `TYPESAFE_API_KEY`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_PUBLIC_KEY`, `LAUNCH_SIGNING_KEY`, `RATE_LIMIT_HASH_KEY`; optional `DB_PATH` (default `data/guess-who.sqlite`, private, never under `public/`), `JEV_MODEL`, `JEV_TIMEOUT_MS`, retention days. Real process env vars override `.env`.

The HTTPS `ORIGIN` makes the app non-local, so ranked play and Discord are enabled as on Workers. The hourly maintenance timer runs in-process. SQLite data lives on the ephemeral filesystem and is lost on redeploy (accepted). Without `TRUST_PROXY=1` all users share one IP rate-limit bucket; set `TRUST_PROXY=1` only if the proxy overwrites `X-Forwarded-For`/`X-Forwarded-Host` (rightmost hop is used). Origin/CSRF checks are unchanged, except that `GET /api/health` (static `{ok,game,version}`, no session or data) is exempt from the Host check so platform health checks with their own Host succeed. Set the platform health/root path to `/api/health`; `/` and every other route still return 403 for a foreign Host.

## Rate limits and recovery

Application defaults: 240 API requests/minute per IP-derived bucket; 60 browser mutations/minute per session; 10 guest or 30 signed-in game creations/hour per actor/session; one active ranked game per Discord account. Session/IP rotations can bypass some application-only limits. Add edge controls for public anonymous inference exposure.

The UI can resubmit an ambiguous human action with the same idempotency key. A JEV decision lease expires after 20 seconds. Stale commits are discarded; their provider attempts remain operational telemetry. A disconnected client can resume until the 24-hour server match expiration. A failed provider decision permanently removes leaderboard eligibility.

Authentication/schema errors do not retry that request. Operational telemetry captures the failure, but there is no automatic cross-request circuit breaker or alert-delivery integration. Configure a provider spend cap and external alerting for public launch.

## Retention, backups, and data requests

Back up the private database to a restricted location. Do not publish active match rows or raw operational actor keys. Check your organization's privacy requirements before choosing the default 90/730-day retention values.

Account deletion/export workflows are operator procedures, not a public self-service feature in this release. Resolve open ranked matches, delete or anonymize associated results as appropriate, revoke application sessions, and keep leaderboard/privacy semantics consistent. Add a documented user-facing privacy notice before public deployment.

## Release checklist

- Run the test suite and benchmark; inspect failures rather than skipping them.
- Smoke-test OAuth, signed launch, context expiry/replay, live JEV success, timeout, and a deliberately invalid model in staging.
- Confirm either secret is absent from live network responses except the human's own allowed secret.
- Complete an eligible ranked match and verify exactly one result in the expected three scopes.
- Confirm a fallback match enters no official board.
- Validate D1 ranking queries, migrations, cron, quotas and asset headers in the deployed environment.
- Test Safari, Firefox, Chromium and representative touch devices; the supplied evidence is Chromium-only.
- Review candidate portraits/text labels and keyboard/screen-reader experience.
- Set stable secrets, provider spending limits, privacy/retention notice, database backups, monitoring and incident procedures.
- Keep old rules/model versions or drain active matches before changing verification behavior.

These are release gates, not actions claimed to have been completed against your external accounts.
