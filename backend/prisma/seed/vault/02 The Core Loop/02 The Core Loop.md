# 02 The Core Loop

A core loop is the 15–90 second cycle a player repeats hundreds of times. Polish it before anything else.

## Shape
```ascii
   ┌──────────► ACT (dig / roll / fight) ──────────┐
   │                                               ▼
 UPGRADE ◄── SPEND ◄── REWARD (coins, items, XP) ◄─┘
   │
   └──► unlocks NEW GOAL (zone, rarity, boss)
```

## Requirements
1. **Feedback within 100 ms** of every input: sound, particle, number pop.
2. **Reward variance:** most rewards small, some medium, rare jackpots. The jackpot must be visible to everyone in the server.
3. **An upgrade every 2–4 loops** in the first session, slowing to every 8–12 loops by hour two ([[04 Progression and Economy]]).
4. **One-thumb playable** on mobile; the main action button lives in the right-thumb zone ([[05 UI and HUD]]).
5. **Session goal:** a player who stops after 25 minutes has unlocked something new.

## Our loops
| Game | Act | Reward | Spend |
|---|---|---|---|
| Anime Awakening RNG | Roll an Awakening (1.2 s animation) | Awakening + shards | Luck boosts, raid entries |
| Dig Up a Dino | Dig a tile (0.6–1.0 s) | Fossils, coins | Tools, backpack, museum slots |
