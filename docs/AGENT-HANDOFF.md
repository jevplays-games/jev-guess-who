# Engineering agent handoff

## Current state

This is implemented source, not a bootstrap prompt. Read `README.md`, `reports/VALIDATION.md`, `docs/ANALYTICS.md` and `docs/SECURITY.md` first. Preserve the original requirements file as user-authored material. No external credentials or production deployment are included.

## First commands

```sh
npm test
npm run check
npm run verify -- reports/sample-replay.json
npm start
```

Open localhost:8787 and play Practice. For full browser HTTP testing in a normal environment, install the optional Playwright tooling described in the README and run `npm run test:browser`. The included browser report uses a clearly marked environment-specific bridge fixture, not a live-origin browser test.

## Changes must preserve

1. Live secrets and seeds remain server-only; decision input contains neither secret. Never pass entire private state to an external model.
2. The deterministic rules engine remains DOM/network/storage/clock independent. Replays reconstruct the same state.
3. The browser cannot submit an outcome or official score. Ranked results require server verification and exactly-once guarded SQL insertion.
4. Discord OAuth identity does not prove arbitrary channel context. Keep signature validation, subject binding, state/nonce consumption and context expiration.
5. Missing provider data is null/unknown, not zero. Confidence is not win probability; local/fallback are never labeled actual JEV.
6. Preserve cohort/version separation, history caps, retention labels and explicit cost coverage. Do not merge measurements across incompatible opponent revisions.
7. Do not add client secrets, credentials, local database files or personal data to the archive or Git.

## Release tasks not performed by the package builder

Provision staging services, configure secrets, exercise a real TypeSafe Choice request, test a real Discord code exchange and signed guild command, migrate a real D1 database, run direct-origin Chromium/Firefox/WebKit checks, inspect mobile portraits, test deployed concurrency/quotas, configure backups/alerts/budgets and publish retention/deletion notices. Use a separate league for a changed opponent and do not claim strength before a live comparison.

## Analytics expansion protocol

For every metric: define the denominator, unit, measurement boundary, source, null handling, cohort and exclusion rules in `ANALYTICS.md` and `metric-catalog.json`. Add a fixture proving both ordinary and missing-data behavior. Derived question metrics must use only public pre-action candidate sets. Keep mutable real-world pricing as operator input, not a hard-coded assumption. Export coverage metadata with any cap.

## Benchmark protocol

The default 5,760-match suite uses no inference calls. Live requests require `--live --confirm-paid` plus the operator's key. Start with `--limit=24`, inspect reliability and usage, and only then increase coverage. Distinguish all 1,152 starting positions from every possible strategy. Exclude fallback games from strict JEV results, but include failed attempts in cost/reliability diagnostics.

## Version and compatibility protocol

Changes to rules, roster, random initialization, candidate representations or prompt/policy affect replay reconstruction and competitive meaning. Bump the relevant version, retain old replay implementations/migration paths before operating with existing production matches, and add regression fixtures. The current verifier intentionally rejects unsupported versions rather than silently guessing their semantics.
