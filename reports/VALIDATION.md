# Validation record

Build validation: 2026-09-22T05:30:53.924424+00:00. Runtime: **v22.16.0**. These are executed results, not planned acceptance criteria.

## Results

| Check | Actual result | Evidence |
|---|---|---|
| Node rules/analytics/security/API tests | **52 passed; 0 failed** | `unit-tests.tap` |
| Initial game configurations | **1,152**: all 24×24 secret pairs, both starters | `../tests/rules.test.mjs` and TAP log |
| Scripted benchmark matches | **5,760** across five matchups | `benchmark/matches.csv` |
| Scripted benchmark decision rows | **48,374** | `benchmark/decisions.csv` |
| Browser interaction checks | **11 passed; no JavaScript page errors** | `browser-results.json`, `browser-test.log` |
| JavaScript module syntax | **26 modules passed** | `static-checks.json`, `static-check.log` |
| Original roster validation | **24 unique characters; unique trait signatures** | Roster and rules tests |
| Sample terminal replay | **Verified locally** | `sample-replay.json`, `replay-verification.log` |
| Operator export command | **Completed against synthetic local test database** | `operator-export-check.log` |

The API/security suite exercises mocked TypeSafe and Discord requests, including successful and invalid responses, timeout/backoff, OAuth state and signatures, ownership, duplicate requests, compare-and-swap, replay tampering, fallback exclusion, expiry and scoped leaderboard pagination. The operations tests cover activity/retention definitions and discarded provider attempts.

The benchmark files were parsed independently to confirm their row counts match the summary JSON. No secret-bearing local database is included. The replay sample deliberately reveals a completed synthetic practice game's seed; it is not a live ranked result.

## Browser execution boundary

The build environment blocked direct Chromium navigation, including ordinary localhost navigation. The recorded browser test therefore rendered local authored HTML/CSS/ES modules in an inline fixture and forwarded API requests through a Python HTTP bridge to the actual local Node server. The report explicitly identifies this transport.

This exercised DOM rendering, the actual JavaScript rules/UI, HTTP API application behavior through the bridge, automatic elimination, opponent advancement, accessible character descriptions, text cards, rules-dialog keyboard dismissal, analytics tables/cohorts/coverage, mobile four-column layout without horizontal overflow, terminal state/replay availability and World leaderboard loading.

It **did not** validate browser-enforced secure cookies, same-origin/CSP restrictions or a normal browser-to-host transport end to end. Those headers and request checks have separate API tests, but the bridge is not an equivalent browser security test. Run the test's default real-HTTP mode in staging before deployment. The fixture's UUID shim and asset/API bridge are test-only and are not part of the shipped application UI.

Screenshots are from the tested application with synthetic practice data:

- `desktop-game.png`: desktop board, own secret, deduction progress and evidence.
- `desktop-analytics.png`: analytics dashboard and diagnostic tables.
- `mobile-game.png`: 390-pixel layout, own secret above the four-column board.

## Scripted benchmark interpretation

| Matchup | Games | Human wins | Opponent wins |
|---|---:|---:|---:|
| Fixed-order vs balanced | 1,152 | 450 | 702 |
| Random-safe vs balanced | 1,152 | 447 | 705 |
| Random-risk vs balanced | 1,152 | 114 | 1,038 |
| Balanced vs balanced | 1,152 | 576 | 576 |
| Balanced vs bounded Hard search | 1,152 | 390 | 762 |

Each matchup exercises all 1,152 initial configurations. This is exhaustive **initial-position coverage for the selected policies**, not a traversal of every possible action sequence or proof of optimal play. Random-safe waits until a singleton to guess; random-risk permits a legal guess sooner. Their outcomes are intentionally not interchangeable.

**No live JEV requests were made.** The results measure the implemented scripted policies, not TypeSafe JEV's strength. Mocked provider responses validate the adapter but are not inference evidence. Search estimates, repeated positions and shared policies create dependence; reported binomial intervals are descriptive rather than independent-trial research conclusions.

## Asset footprint

File-by-file gzip estimates for every public asset total **40,757 bytes**. Public JavaScript totals **20,601 bytes** under the same method. These are below the project's 150,000-byte all-public-assets and 60,000-byte JavaScript targets. They are not a measured CDN transfer, mobile timing, or Lighthouse score. There are no npm runtime dependencies; Node's built-in SQLite emitted its expected experimental-module warning on this tested runtime.

## Not performed

Real TypeSafe authentication or model comparisons; real Discord authorization or guild command installation; Cloudflare Workers deployment or hosted D1 migration; production load testing; multi-region consistency experiments; a complete browser/device matrix; an independent security or accessibility audit; provider-bill reconciliation; public branding review. No credentials were supplied and no external services were silently provisioned.

## Reproduce

```sh
npm test
npm run check
npm run benchmark
npm run verify -- reports/sample-replay.json
npm start
# In another terminal with optional Playwright installed:
npm run test:browser
```

Live inference is separately opt-in and can incur provider charges; use the explicit flags and credentials described in the README. Never count a local or fallback match as an actual JEV benchmark.
