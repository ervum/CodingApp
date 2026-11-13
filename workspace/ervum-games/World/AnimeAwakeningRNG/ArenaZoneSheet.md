# Anime Awakening RNG — Arena Baseplate & Enemy Dummy Spatial Sheet

## 1. Zone Overview (Workspace.Map & Workspace.Live)
- Zone Name: Awakening Combat Arena [06 World and Look]
- Instance Budget: < 250 instances total (<= 15,000 mobile budget, >= 30 FPS on 800×360 Android) [08 Mobile]
- Arena Floor (Workspace.Map.ArenaBaseplate): 512 × 16 × 512 studs, Position = (0, -8, 0), Color = rgb(48, 52, 64), Material = Enum.Material.Concrete, Anchored = true, CanCollide = true (CombatServer/Source.server.luau).
- Collision Group: Characters registered via PhysicsService with character-to-character collision enabled.

## 2. Living Arena Dummies (Workspace.Live — EnemyAIServer/Source.server.luau)
| Rig Name | World Spawn CFrame | Distance from Origin | Armor Color3 | Weapon Style | AI Behavior & Role |
|---|---|---|---|---|---|
| EnemyDummy | CFrame.new(0, 4.5, -9) | 9.0 studs ahead | rgb(255, 195, 75) Gold | Fists | Immediate 0–10s onboarding M1 target (IsPassiveDummy = true, auto-returns after 4.0s idle or > 60 studs knockback) [01 The First Five Minutes] |
| TrainingDummy | CFrame.new(-10, 4.5, -16) | 18.9 studs NW | rgb(95, 175, 255) Cyan | Sword | Combo & knockback practice rig (IsPassiveDummy = true, 250 HP auto-refill at <= 15 HP) |
| GuardDummy | CFrame.new(10, 4.5, -16) | 18.9 studs NE | rgb(115, 235, 165) Mint | Spear | Toggles frontal guard (IsBlocking) every 4.0s for Guard-Break (R / 4th-hit Finisher) practice |
| AggressiveDummy | CFrame.new(14, 4.5, -24) | 27.8 studs NE | rgb(235, 75, 95) Crimson | Katana | Active gladiator AI (WalkSpeed = 16, DetectionRange = 65, AttackRange = 7.2, 25% reactive block, executes 4-hit combos) |
