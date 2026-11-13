# 03 Rarity and RNG

## Rarity ladder (shared by all our games)
| Tier | Colour (RGB) | Base odds | Feel |
|---|---|---|---|
| Common | Grey (170, 170, 170) | 1 in 2 | constant |
| Uncommon | Green (85, 200, 90) | 1 in 4 | every few rolls |
| Rare | Blue (60, 140, 255) | 1 in 20 | a small cheer |
| Epic | Purple (170, 80, 255) | 1 in 150 | screen flash |
| Legendary | Gold (255, 190, 40) | 1 in 2,500 | server announcement |
| Mythic | Pink-red (255, 60, 110) | 1 in 100,000 | global announcement + cutscene |
| Secret | Rainbow gradient | 1 in 10,000,000 | global announcement, unique title |

## Rules
- **Displayed odds are the real odds**, shown in the roll UI as "1 in N", rounded to 3 significant figures.
- **Weights are integers**; the table total is stored and validated server-side on boot.
- **Luck boosts are multiplicative** on all tiers above Rare, capped at ×10 combined, and the cap is shown.
- **Pity:** Mythic is guaranteed within 60 raid clears; the pity counter is visible.
- **First roll** is a guaranteed Uncommon or better ([[01 The First Five Minutes]]).
- **Rolls happen on the server** with `Random.new()` per player session; the client only plays the animation ([[13 Building It Right]]).

## Rarity reveal timing
| Tier | Reveal length | Skippable |
|---|---|---|
| Common–Rare | 1.2 s | yes, after 0.4 s |
| Epic–Legendary | 2.5 s | yes, after 1.5 s |
| Mythic–Secret | 6 s cutscene | no |
