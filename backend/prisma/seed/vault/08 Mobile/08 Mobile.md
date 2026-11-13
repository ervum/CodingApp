# 08 Mobile

Most of our players are on phones. Every build gets two viewport passes from 108 Tester: **Pass A** when a build is saved and **Pass B** before publishing.

## Viewport matrix
| Device class | Resolution | Must pass |
|---|---|---|
| Notched phone (landscape) | 844×390 | A and B |
| Short Android (landscape) | 800×360 | A and B |
| Older phone | 1334×750 | B |
| Large phone | 2532×1170 | B |
| Tablet | 1024×768 | B |
| PC | 1920×1080 | A and B |

## Checks per viewport
1. Nothing under the Roblox top-left controls or behind the notch ([[05 UI and HUD]] section 2).
2. No button inside the thumbstick or jump zones.
3. Tap targets ≥ 44×44 px; text ≥ 14 px at 800×360.
4. Scrolling frames reachable with a thumb; the close button is reachable without regrip.
5. Currency displays tested at 9,999,999.
6. FPS ≥ 30 on a mid-range phone in the busiest zone.

## Performance budgets
| Budget | Limit |
|---|---|
| Instances in a zone | ≤ 15,000 (StreamingEnabled on, target radius 256) |
| Active particles | ≤ 600 on screen |
| Draw-call-heavy SurfaceGuis | ≤ 20 visible |
| Memory | ≤ 900 MB client on a 3 GB device |
| Join to playable | ≤ 8 s on 4G |
