# Benchmark report

Generated: 2026-09-22T05:29:03.116Z
Runtime: v22.16.0
Mode: LOCAL SCRIPTED — no live JEV calls
Games: 5760; decisions: 48374.

| Matchup | Games | Human wins | Opponent wins | Human win rate |
|---|---:|---:|---:|---:|
| fixed-vs-balanced | 1152 | 450 | 702 | 39.06% |
| random-safe-vs-balanced | 1152 | 447 | 705 | 38.80% |
| random-risk-vs-balanced | 1152 | 114 | 1038 | 9.90% |
| balanced-vs-balanced | 1152 | 576 | 576 | 50.00% |
| balanced-vs-search-hard | 1152 | 390 | 762 | 33.85% |

- This is exhaustive only over the 1,152 starting configurations for the selected policies, not over every legal action sequence.
- Local policy results do not predict live JEV strength.
- Repeated games and paired starts are correlated; binomial intervals are descriptive.
- Scripted decision timing is not a provider-latency measurement.
- Changing the roster or rules invalidates direct comparisons.
