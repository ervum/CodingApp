# M1 Hit Combat, Impact Audio & Arena Enemy Dummies Blueprint

## 1. Player Fantasy & Pillars
- Fantasy: Responsive martial arts and weapon arena combat where every M1 click/tap delivers an instant (<100 ms) strike animation, weapon swing whoosh, and bone-crunching impact audio against living arena dummies [02 The Core Loop].
- Pillars:
 1. <100 ms Input Feedback: Immediate procedural Motor6D strike pose (FistCombo1..4, Combo1..4) and weapon swing audio (SwingFists, SwingBlade, SwingHeavy, SwingBow) on M1 input [02 The Core Loop].
 2. Distinct Impact Audio: Proximity (<= 9.5 studs) and server hitbox (MuchachoHitbox) impact sounds (HitFists, HitBlade, HitHeavy, Block, Parry, GuardBreak) with 3-band EQ and pitch variance [07 Characters, VFX and Assets].
 3. Server-Authoritative Combat & Living Dummies: Server owns cooldowns, hitboxes, damage, posture, and 4 unanchored R6 dummies (EnemyDummy, TrainingDummy, GuardDummy, AggressiveDummy) inside Workspace.Live [00 For Any AI], [13 Building It Right].

## 2. First Five Minutes
- 0-10 s: Spawn facing EnemyDummy (CFrame.new(0, 4.5, -9)), zero popups, clear HUD weapon hotbar (1-5) [01 The First Five Minutes].
- 10-60 s: Press M1 once -> guaranteed <100 ms punch animation (FistCombo1), SwingFists + HitFists audio, damage pop, and dummy flinch [01 The First Five Minutes], [02 The Core Loop].
- 1-3 min: Hold M1 (50 ms poll, 160 ms buffer) to chain 4-hit combos, knock back TrainingDummy, and switch weapons (1 Fists, 2 Sword, 3 Katana, 4 Spear, 5 Bow) [02 The Core Loop].
- 3-5 min: Guard-break GuardDummy with Heavy/Finisher strikes and duel AggressiveDummy [01 The First Five Minutes].

## 3. Core Loop Diagram
ascii
 +----------> ACT: Press/Hold M1 or Mobile Attack (<100 ms) ------------+
 | * Client: PlayProceduralPose + PlaySwing + Proximity Hit |
 | * Server: Validate CanAct, Cooldown, Hitbox & Proximity |
 | v
 UPGRADE / <-- SPEND: Activate Rage [G] / <-- REWARD: Damage, Posture Break,
 MASTERY Switch Style [1-5] Ragdoll Finisher, +8 Rage/Hit
 |
 +--> Unlocks NEW GOAL: Guard-Break GuardDummy & Defeat AggressiveDummy


## 4. Progression & Economy Hooks
- Session Meters (CombatTable): Stamina (100, regen 16/s), Posture (100, regen 18/s), Rage (100, +8 on deal hit, +5 on take hit, +22 on parry, 1.25x damage when active) [04 Progression and Economy].
- Progression Formulas: Upgrade cost base * 1.15^n; Zone unlock 1250 * 4.5^(z-1); Rebirth requirement 100k * 2.2^r (+25% earn multiplier) [04 Progression and Economy].

## 5. Rarity / RNG Model
- Deterministic Combat: M1 hit detection, damage, and cooldowns are 100% deterministic [09 Shops and Monetisation].
- Cosmetic Aura Rolls: Server-side Random.new() per player session using the studio rarity ladder (Common 1 in 2, Uncommon 1 in 4 guaranteed on Roll #1, Rare 1 in 20, Epic 1 in 150, Legendary 1 in 2,500, Mythic 1 in 100,000 with 60-clear pity, Secret 1 in 10,000,000) [03 Rarity and RNG].

## 6. UI & HUD Screen List
- CombatHUD (StaminaHudClient): Health/Stamina/Posture/Rage bars, 5-slot weapon hotbar (>= 44x44 px mobile tap targets, >= 14 px text at 800x360), and right-thumb M1 action button (96x96 on 844x390, 88x88 on 800x360) above the 170x170 Jump keep-out zone [05 UI and HUD], [08 Mobile].
- CharacterMenuClient: Style switcher modal (80% W x 80% H, top-right 44x44 Red Close X rgb(235, 82, 82)) [05 UI and HUD].
- DamageIndicator & NPCHeaderBillboard: World-space damage numbers and dummy nameplates (MaxDistance = 75).

## 7. World Zones
- Workspace.Map (ArenaBaseplate): 512 x 16 x 512 concrete floor (<= 15,000 instances, >= 30 FPS mobile) [08 Mobile].
- Workspace.Live Dummies: EnemyDummy ((0, 4.5, -9), Fists, passive), TrainingDummy ((-10, 4.5, -16), Sword, passive), GuardDummy ((10, 4.5, -16), Spear, periodic block), AggressiveDummy ((14, 4.5, -24), Katana, active AI).

## 8. Data Model
- DataStore Key: player_<userId> with SchemaVersion = 1, session locking, 120s auto-save + save on leave, pcall with 3 retries [13 Building It Right].
- Replicated Entity Attributes (StateHandler): EquippedWeapon, Combo, Stamina, Posture, Rage, IsAttacking, IsBlocking, IsStunned, IsRagdolled, IsDashing, IsRageActive, CanVanishFollowUp, IsPassiveDummy, LastCombatHitTime.

## 9. Server / Client Architecture & Shared Luau Type Contracts
- Remotes (ReplicatedStorage.RemoteEvents):
 - CombatAction (Client -> Server): Validated with typeof, rate-limited per action via IsRateLimited, guards against NaN/inf vectors [13 Building It Right].
 - VFXReplication (Server -> All Clients): Broadcasts Slash, Hit, Block, Parry, GuardBreak, Vanish, AirSlam, RageAwaken.
- Shared Modules (ReplicatedStorage.Modules):
 - CombatTypes: Exports StateValue, AttackStepDescriptor, SkillsetMap, WeaponDescriptor, VFXPayload, CombatActionPayload, CombatTypesModule.
 - AnimationHandler: Exports TrackDictionary, MotorRestMap, PoseKeyframe, PoseDefinition, AnimationHandlerModule (PlayAnimation, PlayProceduralPose, StopProceduralPose, StopAnimation, StopAllCombat, ApplyHitstop, CleanupCache).
 - SoundHandler: Exports SoundDescriptor, SoundHandlerModule (SoundProfiles, PlaySound, PlaySwing, PlayImpact).

## 10. Monetisation Surfaces
- Honest prices, zero PvP pay-to-win, first offer after minute 10 [01 The First Five Minutes], [09 Shops and Monetisation]: Impulse 49 R$ (2x Practice Shards), Starter 99 R$ (Starter Pack), Core 199 R$ (2x Awakening Luck), VIP 399 R$.

## 11. Live-Ops Hooks
- Data-driven tuning via CombatTable and WeaponConfig; custom event/raid boss spawning via EnemyAIServer.SpawnArenaNPC.

## 12. Test Plan & Milestone List
- M1 (m1_combat_blueprint_types): Blueprint & --!strict shared Luau type contracts (DONE).
- M2 (m1_procedural_anim_audio): <100 ms M1 procedural strike animation & proximity/hitbox impact audio (DONE).
- M3 (server_hitbox_enemy_dummies): Server-authoritative M1 hitboxes & 4 unanchored arena dummies in Workspace.Live (DONE).
- M4 (mobile_hud_playtest_gate): 108 Tester Pass A & Pass B on 1920x1080, 844x390, and 800x360 (TODO) [08 Mobile].
