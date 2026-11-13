# 07 Characters, VFX and Assets

## Characters
- R15 rigs only; bosses may be custom rigs but must have a Humanoid for targeting.
- Boss scale 2.5–4× player height; the hit box is a separate invisible part.

## VFX by rarity
| Tier | Particles | Light | Sound |
|---|---|---|---|
| Common–Rare | ≤ 40 | none | short pop |
| Epic–Legendary | ≤ 120 | PointLight 8 studs | rising chime |
| Mythic–Secret | ≤ 300 (1.5 s burst) | screen flash + beam | unique sting |

## Asset rules
- Naming: `<Game>_<Category>_<Name>_<Variant>` (e.g. `AAR_VFX_AwakenBurst_Purple`). Registry in [[Our assets]].
- Meshes ≤ 10k tris (props ≤ 2k); textures ≤ 1024² (512² for props).
- Audio: normalised to −14 LUFS; loops seamless; all audio we own or have a licence for.
- No asset ID is invented: unknown IDs are written "pending upload".
