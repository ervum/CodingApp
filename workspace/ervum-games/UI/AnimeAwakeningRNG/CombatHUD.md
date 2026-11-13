# Anime Awakening RNG — CombatHUD Wireframe & Mobile-First Spec

Genre Convention: Action / Arena RNG Combat [05 UI and HUD], [08 Mobile]

## 1. ASCII Wireframe (800×360 Mobile Landscape Safe Area)
ascii
+------------------------------------------------------------------------------+
| [TopBar Keep-Out 58px] |
| |
| +----------+ |
| | HIT | |
| | [M1] | |
| +-------------------------------+ | 88x88 | |
| [Thumbstick] | STYLE: FISTS • COMBO 1x | +----------+ |
| Keep-Out | [HP 100 / 100 ] | [Jump Button] |
| 170x170 px | [STM 100 / 100 ] | Keep-Out |
| Bottom-Left | [GUARD STABILITY: 100% ] | 170x170 px |
| | [RAGE: 0% ] | Bottom-Right |
| +-------------------------------+ |
| [M1] [R] [F] [Q] [SPC] [G] [M] |
+------------------------------------------------------------------------------+


## 2. Component Hierarchy & Sizing (StaminaHudClient & CharacterMenuClient)
| Element | ClassName | Size | Position / Anchor | Notes |
|---|---|---|---|---|
| CombatHUD | ScreenGui | Fullscreen | IgnoreGuiInset = true | ResetOnSpawn = false, ZIndexBehavior = Sibling [05 UI and HUD] |
| MainStatusCard | Frame | 380 × 118 px | Anchor (0.5, 1), Pos (0.5, 0, 1, -72) | Dark card rgb(18, 21, 30), UICorner 12px, UIStroke 1.4px |
| HealthMeter / StaminaMeter / PostureMeter / RageMeter | Frame | 100% - 28px | Stacked inside MainStatusCard | PrimaryFill + GhostFill (0.28s delay) + GothamBold readout |
| ActionHotbarRow | Frame | 480 × 46 px | Anchor (0.5, 1), Pos (0.5, 0, 1, -18) | 7 slots (64 × 44 px >= 44 × 44 px mobile minimum) [08 Mobile] |
| PrimaryHitActionButton | TextButton | 88 × 88 px | Anchor (1, 1), Pos (1, -24, 1, -184) | Green CTA rgb(68, 214, 72), UIStroke 3px, above 170 × 170 Jump zone [05 UI and HUD], [08 Mobile] |
| ArsenalDrawerPanel | Frame | 440 × 340 px | Anchor (0.5, 0.5), Pos (0.5, 0, 0.46, 0) | Modal with 44 × 44 px Red Close button rgb(235, 82, 82) and 46 px tall weapon cards [05 UI and HUD] |
