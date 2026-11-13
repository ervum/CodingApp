--!strict

local ReplicatedStorage: ReplicatedStorage = game:GetService('ReplicatedStorage');
local ModulesFolder: Instance = ReplicatedStorage:WaitForChild('Modules');
local CombatTypes = require(ModulesFolder:WaitForChild('CombatTypes') :: ModuleScript);



export type AttackStepDescriptor = CombatTypes.AttackStepDescriptor;
export type SkillsetMap = CombatTypes.SkillsetMap;



---> Ranged Bow per-combo attack envelope descriptors.
local BowSkillset: SkillsetMap = {
	['1'] = {
		Damage           = 12.0,
		PostureDamage    = 15.0,
		HitboxDelay      = 0.16,
		HitboxDuration   = 0.18,
		RecoveryDuration = 0.16,
		HitboxSize       = Vector3.new(4.2, 4.2, 18.0),
		HitboxOffset     = CFrame.new(0, 0, -10.0),
		KnockbackSpeed   = 10.0,
		StunDuration     = 0.35,
		GuardBreak       = false,
		CausesRagdoll    = false,
	},
	['2'] = {
		Damage           = 12.0,
		PostureDamage    = 16.0,
		HitboxDelay      = 0.16,
		HitboxDuration   = 0.18,
		RecoveryDuration = 0.16,
		HitboxSize       = Vector3.new(4.2, 4.2, 18.0),
		HitboxOffset     = CFrame.new(0, 0, -10.0),
		KnockbackSpeed   = 10.0,
		StunDuration     = 0.35,
		GuardBreak       = false,
		CausesRagdoll    = false,
	},
	['3'] = {
		Damage           = 14.0,
		PostureDamage    = 20.0,
		HitboxDelay      = 0.18,
		HitboxDuration   = 0.20,
		RecoveryDuration = 0.18,
		HitboxSize       = Vector3.new(4.6, 4.6, 20.0),
		HitboxOffset     = CFrame.new(0, 0, -11.0),
		KnockbackSpeed   = 14.0,
		StunDuration     = 0.42,
		GuardBreak       = false,
		CausesRagdoll    = false,
	},
	['4'] = {
		Damage           = 24.0,
		PostureDamage    = 50.0,
		HitboxDelay      = 0.24,
		HitboxDuration   = 0.22,
		RecoveryDuration = 0.26,
		HitboxSize       = Vector3.new(5.5, 5.5, 24.0),
		HitboxOffset     = CFrame.new(0, 0, -13.0),
		KnockbackSpeed   = 75.0,
		StunDuration     = 0.95,
		GuardBreak       = true,
		CausesRagdoll    = true,
	},
	['Heavy'] = {
		Damage           = 28.0,
		PostureDamage    = 70.0,
		HitboxDelay      = 0.26,
		HitboxDuration   = 0.24,
		RecoveryDuration = 0.28,
		HitboxSize       = Vector3.new(6.0, 6.0, 26.0),
		HitboxOffset     = CFrame.new(0, 0, -14.0),
		KnockbackSpeed   = 82.0,
		StunDuration     = 1.15,
		GuardBreak       = true,
		CausesRagdoll    = true,
	},
};



return BowSkillset;
