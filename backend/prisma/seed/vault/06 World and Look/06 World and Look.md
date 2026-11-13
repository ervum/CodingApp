# 06 World and Look

## Visual pillars
1. **Readable silhouettes:** every zone has one landmark visible from spawn.
2. **Saturated, not noisy:** two dominant hues per zone and one accent.
3. **Light leads the player:** the brightest thing on screen is where they should go.

## Lighting baseline (Future lighting)
| Property | Default | Notes |
|---|---|---|
| Lighting.Technology | Future | fall back to ShadowMap automatically on low-end |
| Brightness | 2.2 | |
| EnvironmentDiffuseScale / SpecularScale | 0.6 / 0.8 | |
| Atmosphere.Density | 0.3 | 0.45 for Amber Canyon dust |
| ColorCorrection.Saturation | 0.15 | never above 0.3 |
| Bloom.Intensity / Threshold | 0.6 / 1.6 | |

## Zone colour script
| Game | Zone | Dominant hues | Accent |
|---|---|---|---|
| Dig Up a Dino | 1 Fern Valley | green, tan | orange flags |
| Dig Up a Dino | 2 Amber Canyon | orange, amber | teal crystals |
| Anime Awakening RNG | Lobby | indigo, white | purple Awakening portal |
| Anime Awakening RNG | Shogun Arena | black, crimson | violet blade glow |

Performance budgets are in [[08 Mobile]]; asset rules in [[07 Characters, VFX and Assets]].
