# 04 Progression and Economy

## Currency rules
- **One soft currency** per game (Coins / Shards) earned by playing; **Robux products** never sell soft currency directly in more than 3 sizes.
- Every currency has **at least 3 sinks** (upgrades, cosmetics, consumables).
- Show **earn rate per minute** in the economy sheet for a median player.

## Curve formulas we use
| Thing | Formula | Notes |
|---|---|---|
| Upgrade cost (level n) | `base × 1.15^n` | base set so upgrade #1 costs 2–3 loops of reward |
| Zone unlock (zone z) | `1250 × 4.5^(z-1)` | zone 2 at ~6 min, zone 3 at ~25 min, zone 4 at ~2 h |
| Rebirth requirement | `100k × 2.2^r` | each rebirth gives +25% earn multiplier |

## Time targets (median player)
| Milestone | Target |
|---|---|
| First upgrade | < 1 min |
| Zone 2 | 5–8 min |
| First rebirth | 45–75 min |
| Zone 5 | 6–10 h |

## Checks before shipping a change
- The first 20 levels table is attached.
- Expected value of every sink is computed.
- No currency can be farmed AFK faster than active play.
