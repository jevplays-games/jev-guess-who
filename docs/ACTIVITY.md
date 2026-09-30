# Discord Activity mode

Discord can launch the game as an Activity: an iframe on `https://<DISCORD_CLIENT_ID>.discordsays.com` that Discord proxies to this Worker. The normal browser flow is unchanged; Activity mode is used only when the page URL carries Discord's `frame_id` query parameter.

## How it works

1. **Sign-in.** The page dynamically imports `/activity.js` and the vendored Embedded App SDK (`/vendor/discord-embedded-app-sdk.js`, same origin because the CSP is `script-src 'self'`). It calls `sdk.commands.authorize` (scope `identify`) and posts the code to `POST /api/activity/session`. The server exchanges the code **without** `redirect_uri` using the existing `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET`, upserts the user exactly as the OAuth callback does (blocked accounts are refused), and creates a 24-hour session. The response carries a bearer token, the CSRF token and the Discord access token (returned once for `sdk.commands.authenticate`; never stored). Only the SHA-256 of the bearer token is stored.
2. **Bearer sessions.** `Authorization: Bearer <64 hex>` is accepted in place of the `jev_session` cookie. The token is held in page memory only.
3. **Origin rule.** `Origin: https://<DISCORD_CLIENT_ID>.discordsays.com` is accepted for mutations **only** when the session was authenticated by bearer token. Cookie sessions, other origins and other applications' `discordsays.com` origins still get `403 origin_rejected`. CSRF tokens are still required.
4. **Framing.** Non-API documents are sent with `frame-ancestors 'none'`. When the request has `frame_id`, only that directive is replaced with `https://discord.com https://ptb.discord.com https://canary.discord.com`; the rest of the CSP is untouched. API responses are never frameable.

New endpoints: `GET /api/activity/config` (public client id) and `POST /api/activity/session`. Neither exposes match or secret-character state. Session creation is rate limited (60/hour/IP) in addition to the global API limit.

## Portal settings

In the Discord Developer Portal for this application:

- Enable **Activities**.
- Under Activities > URL Mappings set the root mapping: prefix `/` -> `guess-who.jevplay.games` (the value of `ORIGIN`, without scheme).
- Make sure the OAuth2 scope `identify` is allowed. No redirect URI is needed for the SDK exchange.

## Entry Point command

Enabling Activities makes Discord create a primary Entry Point command. `npm run discord:register` posts only `/play-jev` (create or update by name) and does not bulk overwrite, so the Entry Point command is preserved. If the registration script is ever changed to a bulk overwrite, include the existing Entry Point command in the payload or Discord will reject or remove it.

## Local testing

Activity mode needs Discord's proxy and cannot be exercised on localhost. Automated coverage lives in `tests/activity.test.mjs` with a mocked Discord.
