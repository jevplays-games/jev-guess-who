# HTTP API

All paths are same-origin. Errors use `{"error":"code"}`. JSON mutation bodies are limited to 16 KiB; signed Discord bodies and provider responses use their separately bounded limits. Standard security headers include no-store for API responses, no-referrer, nosniff, and a restrictive CSP.

## Browser session contract

`GET /api/me` establishes a guest session when needed. Its JSON includes `csrf`, optional `{id,name}` user, feature-configuration flags, context and activeMatchId. Authentication uses an HTTP-only cookie, not a browser-readable bearer token.

Every browser POST requires the correct `Origin`, `Content-Type: application/json`, and `X-CSRF-Token`. Discord interactions are the exception: raw request body plus Ed25519 headers authenticate that endpoint.

## Endpoints

| Method / path | Request | Result / constraints |
|---|---|---|
| GET `/api/health` | None | Runtime health/version, no credentials |
| GET `/api/me` | Existing cookie optional | Session/CSRF/profile/context; creates guest cookie if absent |
| GET `/api/auth/discord` | Session | Redirect to OAuth with single-use browser-bound state |
| GET `/api/auth/discord/callback` | `code`, `state` | Server exchange, session rotation, clean redirect |
| POST `/api/logout` | `{}` + CSRF | Invalidates the current session; does not erase a ranked attempt |
| POST `/api/discord/interactions` | Raw Discord payload/signature headers | Ping or validated ephemeral signed launch link |
| POST `/api/context/redeem` | `{token}` + signed-in session/CSRF | Consumes user-bound token; stores fresh context |
| POST `/api/games` | `{gameId,difficulty,mode,requestId}` | Authoritative creation; 201 snapshot |
| GET `/api/games/:id` | Owner session | Secret-safe state snapshot; expiration checked |
| POST `/api/games/:id/actions` | `{actionId,expectedRevision,action}` | One authoritative human action; safe duplicate-key retries |
| POST `/api/games/:id/advance` | `{}` | One leased JEV/local turn, or 202 pending; no client-selected opponent action |
| GET `/api/games/:id/replay` | Owner; terminal match | Complete private replay export; never while active |
| GET `/api/analytics` | Session; optional difficulty/mode/starter/from | Owner-only bounded history and aggregate analytics |
| GET `/api/leaderboard` | Session; scope/period/difficulty/cursor | World or verified community cohort; up to 50 entries |

There is intentionally **no client score-submission endpoint**, arbitrary SQL endpoint, public private-replay endpoint, admin dashboard endpoint, or browser-supplied guild/channel selection endpoint.

## Create

```json
{"gameId":"guess-who","difficulty":"normal","mode":"practice","requestId":"b71ab189-40f4-4ae1-aa46-426936b42940"}
```

Mode is `practice`, `casual` or `ranked`. Ranked creation requires a Discord identity, a configured JEV key and a pinned versioned model. Difficulty is `easy`, `normal`, `hard` or `jev`. A request ID must be 8–80 ASCII alphanumeric/hyphen/underscore characters. Reuse with different mode/difficulty is rejected.

## Human action

```json
{"actionId":"79d4e581-01ab-4f8d-938f-3d1936c584bf","expectedRevision":2,"action":{"type":"ask","predicateId":"glasses"}}
```

Other legal action shapes are `{"type":"guess","characterId":"c07"}` and `{"type":"resign"}`. Unknown/extra action fields are rejected. A guess must be among the remaining candidates. Resignation is permitted on the human's turn.

The same action ID and same normalized payload returns the already accepted result. Conflicting payload reuse is 409. A new action with an old revision is 409. An illegal game action is 422.

## Snapshot projection

A snapshot includes rules/roster versions, match ID, revision, phase, turn, ownSecret, public possible masks, asked predicates, counters, legalActions, config, commitment, eligibility, expiry, history and analytics. `revealedSecrets` appears only after termination. No live seed, private initial state, provider API key or opponent secret is present.

History includes structured decision evidence, not hidden chain-of-thought. Candidate information is public game evidence. Token usage is included when the provider returned it.

## Leaderboard

`scope=world|server|channel`; `period=week|all`; `difficulty=easy|normal|hard|jev`. `week` is the creation-week cohort starting Monday 00:00 UTC. `all` means retained results, not data already deleted by retention.

Community IDs are derived from the authenticated session's unexpired signed launch context. Supplying editable guild/channel query parameters does not change scope. A cursor is signed, expires after five minutes, binds scope/league/week/community, and fixes the result-ID cutoff so subsequent pages do not mix newly inserted results.

Qualified users have at least 20 games. Provisional users follow qualified entries. Ranking uses Wilson lower bound, then wins, then stable user ID. UI speed is not a ranking criterion. Display names are data, never HTML.

## Analytics coverage

The personal endpoint scans at most 500 newest stored matches and applies filters within that scan. Coverage includes asOf, availableStoredMatches, scanned, filtered and truncated. Summaries omit historical event arrays; `detailEndpoint` points to an owner-checked match snapshot. The current match response contains full events.

Neither client-side filters nor query parameters can read another account's history. No arbitrary user ID is accepted by this endpoint.

## Common errors

- 400: malformed JSON/parameters, unsupported game, invalid cursor.
- 401: session, Discord identity, or Discord signature required.
- 403: origin/CSRF mismatch, forged/expired context, blocked account.
- 404: unknown route or match not owned by the requester.
- 409: stale revision, conflicting idempotency key, active ranked match, live replay request.
- 413: body limit exceeded.
- 415: JSON content type required.
- 422: illegal action or replay verification failure.
- 429: application quota; Retry-After response header provided.
- 502/503: unavailable/unconfigured external integration.

Never assume an interrupted HTTP request failed to commit. Refresh or retry the same human action ID before generating a replacement action.
