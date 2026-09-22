# Analytics specification and interpretation

Version: `analytics-1`. The analytics expansion is an implementation addition requested after the original A–Z architecture plan. It does not change the native win/loss objective.

## 1. Measurement boundaries

There are four distinct populations. Keep them separate in any claim about strength or reliability.

| Population | Source of truth | Trust / eligibility |
|---|---|---|
| Server gameplay | Authoritative state transitions and accepted decisions | Trusted state; ranked only when eligibility remains true |
| Browser-only practice | Local rules engine and browser storage | Untrusted, unranked, device-local |
| Scripted benchmarks | Enumerated scenarios and controlled policies | Synthetic tests, not real users or live JEV |
| Operational telemetry | Server-generated allowlisted events | Operational evidence with retention and write-failure limitations |

The player dashboard provides descriptive all-cohort totals and separate difficulty, starter, source, mode, league, and daily cohorts. The official leaderboard never combines different leagues. Do not compare a mixed-cohort top-line win rate as if it measured one opponent.

## 2. Analytics anatomy

`analyzeAction()` derives per-turn facts from public masks before and after an accepted transition. `analyzeMatch()` derives match-level metrics. `aggregateAnalytics()` derives player/cohort summaries. `aggregateOperations()` derives operational activity and reliability.

Analytics never asks JEV to count characters or calculate metrics. The values are computed in JavaScript. Search estimates and returned provider distributions are explicitly marked as different evidence classes.

A completed replay can recompute the game and per-action analytical facts. A live player projection contains no opponent secret, secret seed, raw authorization token, or private initialization object.

## 3. Common statistical conventions

Every numerical distribution reports `n`, `min`, `mean`, `p50`, `p90`, `p95`, `p99`, and `max`. Nonfinite values and `null` are excluded, not converted to zero. An empty distribution has `n=0` and null-valued statistics. A measured zero is preserved.

Quantiles use linear interpolation: sort observations, set `i=(n−1)p`, and interpolate between floor(i) and ceil(i). This matters when comparing results to systems that use nearest-rank quantiles.

Win-rate and guess-calibration intervals use the Wilson interval with z=1.96. These are descriptive binomial intervals. Repeated decisions, repeated players, paired starts, and deterministic benchmark scenarios are not independent samples; the interval is not a proof of generalization or a causal estimate.

Times are milliseconds. Provider timing uses a monotonic process clock. Persisted event timestamps and match duration use server epoch milliseconds. Calendar groupings and weekly periods use UTC.

## 4. Match metadata and outcomes

| Field | Definition |
|---|---|
| `matchId` | Server-issued or locally generated identifier, not a Discord identity |
| `createdAt`, `finishedAt` | Authoritative creation/terminal timestamps; unfinished completion is null |
| `difficulty` | Easy / Normal / Hard / JEV configuration fixed at creation |
| `leagueId` | Fingerprint of competitive rules, roster, model, prompt, policy, randomness format, and opponent mode |
| `starter` | First actor selected at initialization |
| `mode` | Practice, casual, ranked, or synthetic benchmark |
| `source` | JEV, fallback, or local heuristic, with fallback taking precedence at match level |
| `phase` | Active or finished in normal operation |
| `winner`, `reason` | Native game outcome and terminal reason; absent while active |
| `eligible` | Whether the match still qualifies for official results; not a synonym for “human won” |
| `durationMs` | Finished time minus creation time; includes idle and reconnect intervals |
| `analyticsVersion` | Analytics interpretation version |

Direct website matches can qualify for World only. A verified Discord launch can attribute the same eligible result to its channel, server, and World cohorts. Attribution is not inferred from editable query parameters.

## 5. Actor-level metrics

The same fields exist for `actors.human` and `actors.jev`.

| Metric | Calculation / meaning |
|---|---|
| `turns` | Accepted actions by that actor; a final guess or resignation counts as a turn |
| `questions` | Accepted informative trait questions |
| `remaining` | Final/current size of that actor's opponent-secret candidate set |
| `guesses` | Number of final-guess actions, normally 0 or 1 |
| `correctGuesses` | Final guesses that matched the opponent secret |
| `riskyGuesses` | Final guesses made with more than one surviving candidate |
| `totalEliminated` | Sum of actual removals on that actor's questions |
| `expectedInformationGain` | Distribution of entropy reduction expected before each question |
| `realizedInformationGain` | Distribution of entropy reduction observed after each answer |
| `informationGainRegret` | Best legal question's expected information minus selected question's expected information |
| `splitBalance` | Distribution of 1 − abs(yes−no)/n; 1 is an even split |
| `wallTurnMs` | Time since the previous accepted transition, including idle/network/reconnection time |

Information regret is restricted to legal questions. It is not a claim that the most informative question always wins the competitive race. Guesses have null question-information regret rather than an invented information score.

## 6. Exact per-turn fields and formulas

Let n be candidates before the question, y the yes branch, z=n−y, and r the observed surviving branch size. The server uses a uniform prior over surviving characters.

| Field | Formula / interpretation |
|---|---|
| `beforeCount`, `afterCount` | Candidate-set cardinalities before/after the committed action |
| `opponentBeforeCount` | Publicly derivable candidate-set size of the other actor |
| `eliminated` | n−r for a question; zero for a guess/resignation |
| `entropyBefore`, `entropyAfter` | log2 of the respective candidate count |
| `expectedInformationGain` | −(y/n)log2(y/n) − (z/n)log2(z/n) |
| `realizedInformationGain` | log2(n/r), after the actual answer |
| `informationGainRegret` | max legal-question expected gain minus selected expected gain, clamped at 0 |
| `splitBalance` | 1 − abs(y−z)/n |
| `expectedRemaining` | (y²+z²)/n |
| `worstCaseRemaining` | max(y,z) |
| `singletonProbability` | (1[y=1]+1[z=1])/n |
| `guessWinProbability` | 1/n for final guesses only |
| `riskyGuess` | Final guess and n>1; null for non-guesses |
| `wallTurnMs` | Current server timestamp minus previous committed event timestamp |
| `searchRegret` | Best candidate search estimate minus selected estimate, only when comparable estimates were generated |
| `sequence`, `actor`, `action` | Ordered replay event identity |
| `answer` | Boolean answer for a question; absent otherwise |
| `correct` | Terminal-guess correctness; absent otherwise |
| `requestId` | Idempotency token for a human action; not an identity credential |

Question efficiency is evaluated using the pre-action public mask. It does not peek at the actual secret to determine which question should have been selected.

## 7. JEV decision evidence

A decision records selected action, source, pinned model, prompt/policy versions, input hash, candidate count, candidate evidence, optional search metadata, request size, feature-build time, attempts, distribution, confidence, and elapsed decision time.

`candidateEvidence` includes every candidate admitted by that difficulty, not just the winner. Hard/JEV candidates carry bounded-search estimates. Equivalent partitions may be canonicalized. Easy limits the question set. The raw legal surface never exceeds 36 actions.

The input hash is over the canonical redacted request payload. It commits to the public evidence sent for that decision, not the secret identity. Raw provider credentials and authorization headers are never recorded.

`source` has separate values:

- `jev`: validated provider Choice.
- `forced_rule`: only one admitted action exists; no provider request is made.
- `fallback`: failed/unconfigured JEV path followed by deterministic fallback.
- `local_heuristic`: explicitly selected local practice/synthetic policy.

A forced action is not counted as a successful provider call. A fallback is not credited to JEV strength.

## 8. Model-distribution metrics

Provider probabilities describe the selection distribution over actions. They are not a probability distribution over mystery identities unless the game explicitly models that separately.

| Metric | Definition |
|---|---|
| `confidence` | Provider-returned statistic, validated to lie in [0,1] |
| `entropy` | −sum(p log2 p) over positive action probabilities |
| `normalizedEntropy` | Entropy / log2(candidate count); zero for a singleton |
| `topMargin` | Largest minus second-largest action probability |
| `candidateCount` | Number of options supplied in the Choice |
| `completedSearchDepth` | Last fully completed iterative-deepening pass |
| `nodes`, `nodeBudget` | Actual counted search nodes and deterministic bound |
| `estimatedWinProbability` | Policy-relative bounded expectiminimax estimate for a candidate |
| `searchRegret` | Difference from the highest estimate in the same candidate set and completed search |

Do not calibrate selection confidence against match wins as though confidence predicted wins. The included guess-calibration table instead uses the exact prior 1/n and observed guess correctness, grouped by remaining-candidate count.

## 9. Provider reliability, timing, usage and cost

| Metric | Meaning |
|---|---|
| `decisions` | Accepted source=JEV decisions |
| `forcedDecisions`, `fallbackDecisions` | Counted separately |
| `attempts` | Provider attempts attached to accepted decisions |
| `retries` | Sum of max(attempt count−1,0) per decision |
| `failedAttempts` | Attempts carrying an error reason |
| `invalidAttempts` | Failed strict-schema/selection validations |
| `timeoutAttempts` | Aborted requests that exhausted the deadline |
| `errorReasons` | Separate error-category counts, including HTTP categories |
| `latencyMs` | Successful JEV decision end-to-end timing, including feature build/retry overhead |
| `attemptLatencyMs` | Individual provider request/response attempt timing |
| `buildMs` | Local candidate/evidence construction timing |
| `requestBytes` | UTF-8 request JSON byte length; not token count |
| `knownInputTokens`, `knownOutputTokens` | Sum of observed, validated usage records |
| `usageCoverage` | Attempts with valid token usage / recorded attempts |
| `pricingInputUsdPerMillion` | Operator-supplied price snapshot, or null |
| `inputCostUsd` | Input usage × supplied rate only when all recorded attempts have known usage |
| `knownInputCostLowerBoundUsd` | Cost of observed input usage only when an operator rate exists |

No price is silently baked into this package. A configured rate is a cost input, not verification of an invoice. Discounts, taxes, plan charges, future pricing changes, and unobserved provider work are outside this calculation.

Player/match cost fields cover **recorded accepted-decision attempts**, not a complete provider bill. To capture paid work discarded by a revision/lease race, each attempted call is also written to operational `jev_attempt` telemetry before state commit. `jev_stale_response` identifies discarded responses. The operator report covers those attempts, subject to telemetry-write failures and retention. Neither report should claim full invoice reconciliation.

## 10. Player/cohort analytics

For each cohort, the report includes starts, finishes, active games, human wins/losses, human win rate and Wilson interval, mean human and JEV questions, eligible games, resignations, and expirations.

Cohorts include difficulty, starting player, difficulty×starter, opponent source, match mode, league fingerprint, and UTC creation day. Daily results group by creation day, so a game finishing after midnight remains in its creation cohort.

Streaks are ordered by finishedAt then matchId. A loss resets the current streak. A selected dataset can contain multiple match types; those streaks are descriptive for the current filter and are not leaderboard ranking criteria.

The question table includes uses, human/opponent uses, yes/no counts, mean characters removed, mean expected information, and mean question-information regret.

## 11. Operational activity, retention and funnel

Operational analytics is available through the operator-only local export, not an unauthenticated dashboard.

Activity separately counts Discord-account pseudonyms and guest-session pseudonyms. “Daily”, “weekly”, and “monthly” activity use rolling 24-hour, 7-day, and 30-day windows ending at the export's `asOf`. The daily table uses UTC calendar days and includes starts, unique active account/session keys, completions, expirations, provider attempts, fallbacks, and request rejections.

Day-1, day-7 and day-30 retention uses a Discord player's **first observed start in retained telemetry**. A return means at least one start on exactly the target UTC day. Only fully elapsed target days enter the denominator. It is not rolling return, lifetime acquisition retention, or guest retention.

The funnel exposes counts of OAuth starts, successful Discord logins, context redemptions, game starts, completions and expirations. These are event counts, not a joined user-conversion funnel. Guest/session identity changes at login prevent presenting an unsupported conversion rate.

Provider operations includes all retained attempted-call events, categorized failures, latency distributions, known token usage, usage coverage, and discarded responses. Errors and throttling use allowlisted event fields.

## 12. Coverage, exports and retention

The owner-scoped API scans at most the latest 500 retained matches, then applies the requested filters. It reports stored total, scanned total, filtered total, snapshot time and truncation. Filtering after that bounded selection can omit older matching games; the coverage notice must remain visible.

The API computes aggregates from the events but omits all historical event arrays from its match-summary response to avoid unnecessarily large downloads. Each summary has an owner-checked detail endpoint. The current board's snapshot still includes its full event analytics.

The SQLite operator export defaults to 10,000 matches and caps telemetry at 100,000 events. Both limits are disclosed in its output. CLI `--limit` changes the match cap up to 100,000. Large-scale incremental warehouse aggregation is not included.

Default server retention is 90 days for detailed terminal matches and telemetry; 730 days for official result summaries. These are configurable operational defaults, not a legal policy. “All time” in this deployment means all retained compatible results. The public UI says “All retained results.” Browser-only local history retains the latest 100 finished practice reports.

Exports include JSON summaries, match CSV, per-turn CSV, completed owner replay JSON, benchmark match/decision CSV, and the operational export. CSV quotes embedded text and prefixes formula-like strings to reduce spreadsheet formula injection.

## 13. Privacy and anti-leak controls

No third-party analytics SDK, cookie-advertising pixel, browser fingerprint, microphone/camera capture, or precise-location telemetry is included. No free-text chat enters the provider state.

Live secrets remain on the authoritative server. Telemetry does not include live secrets, seeds, user names, Discord IDs, OAuth tokens, IP addresses, launch tokens, or JEV credentials. Actor keys are salted hashes. Changing the operational hashing secret breaks identity continuity and therefore affects retention calculations.

The server still stores the minimum Discord identity needed for account ownership and leaderboard names. This is separate from telemetry. Display names are inserted as text, not HTML. Channel/server rows require fresh verified community context.

## 14. What is not measured or claimed

The implementation does not measure clinical attention, intelligence, human skill as a latent trait, unique real humans, external solver assistance, continuous guild membership, actual provider-bill reconciliation, causal feature impact, or live JEV strength without an explicitly run live benchmark.

There is no browser dwell-time tracker, keystroke recorder, hidden user profiling, production administrative web console, automatic statistical experiment assignment, or claim that every possible analytic question has been anticipated. The included catalog documents the implemented metric families, statistic paths, formulas and interpretation boundaries; it is not a claim that every possible analytical question is covered.

See `metric-catalog.json` for the machine-readable catalog and `reports/VALIDATION.md` for what was actually exercised.
