--!strict

local ReplicatedStorage: ReplicatedStorage = game:GetService('ReplicatedStorage');
local ModulesFolder: Instance = ReplicatedStorage:WaitForChild('Modules');
local CombatTypes = require(ModulesFolder:WaitForChild('CombatTypes') :: ModuleScript);



export type AttackStepDescriptor = CombatTypes.AttackStepDescriptor;
export type SkillsetMap = CombatTypes.SkillsetMap;



---> Base (Fists / Martial Arts) per-combo attack envelope descriptors.
local BaseSkillset: SkillsetMap = {
	['1'] = {
		Damage           = 8.0,
		PostureDamage    = 14.0,
		HitboxDelay      = 0.10,
		HitboxDuration   = 0.14,
		RecoveryDuration = 0.14,
		HitboxSize       = Vector3.new(5.5, 5.5, 5.5),
		HitboxOffset     = CFrame.new(0, 0, -3.2),
		KnockbackSpeed   = 6.0,
		StunDuration     = 0.42,
		GuardBreak       = false,
		CausesRagdoll    = false,
	},
	['2'] = {
		Damage           = 9.0,
		PostureDamage    = 16.0,
		HitboxDelay      = 0.10,
		HitboxDuration   = 0.14,
		RecoveryDuration = 0.14,
		HitboxSize       = Vector3.new(5.5, 5.5, 5.5),
		HitboxOffset     = CFrame.new(0, 0, -3.2),
		KnockbackSpeed   = 7.0,
		StunDuration     = 0.44,
		GuardBreak       = false,
		CausesRagdoll    = false,
	},
	['3'] = {
		Damage           = 10.0,
		PostureDamage    = 18.0,
		HitboxDelay      = 0.12,
		HitboxDuration   = 0.15,
		RecoveryDuration = 0.15,
		HitboxSize       = Vector3.new(6.0, 5.5, 6.0),
		HitboxOffset     = CFrame.new(0, 0, -3.5),
		KnockbackSpeed   = 9.0,
		StunDuration     = 0.48,
		GuardBreak       = false,
		CausesRagdoll    = false,
	},
	['4'] = {
		Damage           = 16.0,
		PostureDamage    = 42.0,
		HitboxDelay      = 0.18,
		HitboxDuration   = 0.18,
		RecoveryDuration = 0.24,
		HitboxSize       = Vector3.new(6.8, 6.5, 6.8),
		HitboxOffset     = CFrame.new(0, 0, -4.0),
		KnockbackSpeed   = 78.0,
		StunDuration     = 1.15,
		GuardBreak       = true,
		CausesRagdoll    = true,
	},
	['Heavy'] = {
		Damage           = 20.0,
		PostureDamage    = 60.0,
		HitboxDelay      = 0.22,
		HitboxDuration   = 0.18,
		RecoveryDuration = 0.28,
		HitboxSize       = Vector3.new(7.2, 6.8, 7.2),
		HitboxOffset     = CFrame.new(0, 0, -4.2),
		KnockbackSpeed   = 84.0,
		StunDuration     = 1.25,
		GuardBreak       = true,
		CausesRagdoll    = true,
	},
};



return BaseSkillset;
