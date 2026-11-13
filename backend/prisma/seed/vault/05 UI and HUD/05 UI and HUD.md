# 05 UI and HUD

> The most important rule: **a player understands every screen in one second, on a phone, with a thumb.**

## 1. Viewport targets
| Target | Resolution (landscape) | Notes |
|---|---|---|
| PC | 1920×1080 | design at 1920×1080, test at 1366×768 |
| Mobile — notched | **844×390** | iPhone-class; notch/rounded corners on one side (≈47 px) |
| Mobile — short | **800×360** | common Android; the tightest height we support |
| Tablet | 1024×768 | 4:3; extra vertical space, never stretch buttons |

Use `UIScale` driven by viewport height (`scale = clamp(viewportY / 1080, 0.33, 1)` on PC layouts, mobile layouts designed at native size) and `UIAspectRatioConstraint` on every square button and icon.

## 2. Safe zones (keep-out areas)
| Zone | Where | Size | Rule |
|---|---|---|---|
| Roblox top-left controls | top-left | x 0–160 px, y 0–58 px (`GuiService:GetGuiInset()` top = 58) | **Nothing interactive.** Timers and counters start at x ≥ 172 or move top-center |
| Device notch / rounded corners | the notched side (left or right) | ≈ 47 px on 844×390 | `ScreenGui.ScreenInsets = Enum.ScreenInsets.DeviceSafeInsets` for HUD; full-bleed only for backgrounds |
| Thumbstick | bottom-left | x 0–40% of width, y 45–100% of height | no buttons; toasts must not overlap it |
| Jump button | bottom-right | 170×170 px box from the bottom-right corner (844×390) | no buttons inside; our main action sits **above** it |
| Roblox top-right | top-right | x (W−120)–W, y 0–58 px | keep clear for the Roblox menu on some devices |

## 3. Wireframes

### 3.1 PC HUD — 1920×1080
```ascii
┌────────────────────────────────────────────────────────────────────────────────────────┐
│[R][💬]  ← Roblox (keep clear)        ┌──────── ZONE 2 · AMBER CANYON ───────┐           │
│                                      │  Next: Zone 3  ████████░░░  72%       │  🪙 12,480│
│ ┌────────┐                           └──────────────────────────────────────┘  💎 340   │
│ │ 🎒 Bag │  ← left rail: Bag, Index,                                                    │
│ │ 📖 Idx │     Shop, Quests (64×64,                                                     │
│ │ 🛒 Shop│     gap 12, x=24, y=200)                                                     │
│ │ ✅ Qst │                                                                              │
│ └────────┘                                                                              │
│                                                                                         │
│                                   (3D world)                                            │
│                                                                                         │
│                                                              ┌────────────────────┐     │
│                                                              │  🎲  ROLL  (E)      │     │
│ [toast area: bottom-center, above hotbar]                    │  Green 68,214,72    │     │
│                         ┌─ hotbar 1–5 ─┐                     └────────────────────┘     │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Mobile landscape — 844×390 (notched)
```ascii
┌─notch─┬──────────────────────────────────────────────────────────────────────┐
│       │[R][💬]          ┌── ZONE 2 ── 72% ──┐                  🪙 12.4K  💎340│
│ 47px  │                 └──────────────────┘                                │
│ device│ [🎒]                                                                │
│ safe  │ [📖]   ← rail: 52×52, gap 8, x=safe+12, y=70                        │
│ inset │ [🛒]                                                                │
│       │                         (3D world)                     ┌──────────┐ │
│       │                                                        │ 🎲 ROLL  │ │
│       │  ╭──────────╮                                          │ 96×96    │ │
│       │  │thumbstick│   [ toast: bottom-center, y ≤ H−120 ]    └──────────┘ │
│       │  │  zone    │                                             ╭──────╮  │
│       │  ╰──────────╯                                             │ JUMP │  │
└───────┴───────────────────────────────────────────────────────────╰──────╯──┘
```

### 3.3 Mobile landscape — 800×360 (short)
```ascii
┌────────────────────────────────────────────────────────────────────┐
│[R][💬]        ┌ ZONE 2 · 72% ┐                       🪙12.4K 💎340 │
│ [🎒][📖][🛒]  ← rail turns horizontal under 380 px height, y=62    │
│                                                                    │
│                          (3D world)                  ┌──────────┐  │
│                                                      │ 🎲 ROLL  │  │
│  ╭────────╮                                          │  88×88   │  │
│  │ stick  │       [ toast y ≤ H−110 ]                └──────────┘  │
│  ╰────────╯                                              ╭─────╮   │
└──────────────────────────────────────────────────────────╰JUMP─╯───┘
```

### 3.4 Modal (Shop / Index / Raid) — all sizes
```ascii
┌──────────────────────────── 80% W × 80% H (max 1100×720) ───────────────────────────┐
│  TITLE (Bold 28/22 px)                                                   [ ✕ ] Red  │
│  [Tab][Tab][Tab]                                                                     │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐   ← grid, cell 120×140 PC / 96×112 mobile       │
│ │ item │ │ item │ │ item │ │ item │      ScrollingFrame, AutomaticCanvasSize = Y     │
│ └──────┘ └──────┘ └──────┘ └──────┘                                                  │
│                                                   [ BUY 99 R$ ] Green / Gold premium │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

## 4. Colour semantics (button meaning never changes)
| Meaning | Name | RGB | Use for |
|---|---|---|---|
| Buy / Confirm / Go | **Green** | rgb(68, 214, 72) | Buy, Confirm, Start, Claim, Equip |
| Close / Cancel / Danger | **Red** | rgb(235, 82, 82) | ✕ close, Cancel, Delete, Leave |
| Premium / Robux | **Gold** | rgb(255, 206, 68) | Robux purchases, VIP, premium currency |
| Info / Navigate | **Blue** | rgb(64, 156, 255) | Tabs, Info, Index, "See more" |
| Special / Event | **Purple** | rgb(168, 85, 247) | Limited events, raids, rebirth |
| Disabled | **Grey** | rgb(120, 124, 140) | Unaffordable, locked (always with a lock icon) |
| Text on buttons | **White** | rgb(255, 255, 255) | with a 2 px UIStroke rgb(20, 20, 28) |
| Panel background | **Ink** | rgb(24, 26, 36) at 0.1 transparency | modals, rails |

Rarity colours come from [[03 Rarity and RNG]].

## 5. Components
| Component | PC | Mobile | Details |
|---|---|---|---|
| Primary action | 280×72 | 96×96 (88×88 on 800×360) | UICorner 16, UIStroke 3 px dark, icon + 1 word |
| Standard button | 160×52 | min 44×44 tap target | UICorner 12, label Bold 20/16 |
| Close ✕ | 44×44 | 44×44 | Red, always top-right of the modal |
| Currency counter | 160×40 | 110×32 | compact numbers (12.4K) on mobile, full on PC |
| Toast | max 520×56 | max 360×48 | bottom-center, 2.5 s, never over the thumbstick/jump zones |
| Text | min 18 px PC | min 14 px at 800×360 | font: Builder Sans Bold for labels, Builder Sans Medium for body |

## 6. Genre conventions matrix
| Genre | Main HUD element | Primary action position | Signature screen | Must-have popups |
|---|---|---|---|---|
| RNG | Luck multiplier + roll counter | right thumb, big ROLL | Index (collection grid by rarity) | Rare reveal, pity progress |
| Simulator | Currency + backpack capacity | right thumb, ACT | Upgrade shop | Backpack full → sell |
| Tycoon | Cash + income/sec | world buttons (step-on pads) | Rebirth | Next dropper affordable |
| Obby | Stage number + timer | jump (Roblox default) | Stage select / skip | Checkpoint reached |
| Tower Defense | Wave + base HP + cash | bottom card bar | Unit loadout | Wave start countdown |
| Horror | Minimal (objective only) | context prompt | Lobby / party | None during chases |
| Roleplay | Job/role + money | context prompts | Wardrobe / house editor | Role picker on spawn |

## 7. Checklist before handing a screen to Builder
- [ ] PC, 844×390 and 800×360 wireframes drawn
- [ ] Nothing interactive in the safe zones above
- [ ] Every button's colour matches its meaning (section 4)
- [ ] Tap targets ≥ 44×44 on mobile
- [ ] Text ≥ 14 px at 800×360
- [ ] Numbers tested at 9,999,999 (no clipping)
- [ ] Genre convention named

Related: [[08 Mobile]], [[Claude Design prompts]].
