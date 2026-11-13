--!strict

local ReplicatedStorage: ReplicatedStorage = game:GetService('ReplicatedStorage');
local ModulesFolder: Instance = ReplicatedStorage:WaitForChild('Modules');
local CombatTypes = require(ModulesFolder:WaitForChild('CombatTypes') :: ModuleScript);



export type AttackStepDescriptor = CombatTypes.AttackStepDescriptor;
export type SkillsetMap = CombatTypes.SkillsetMap;



---> Long-reach Polearm / Spear per-combo attack envelope descriptors.
local SpearSkillset: SkillsetMap = {
	['1'] = {
		Damage           = 15.0,
		PostureDamage    = 24.0,
		HitboxDelay      = 0.15,
		HitboxDuration   = 0.16,
		RecoveryDuration = 0.18,
		HitboxSize       = Vector3.new(5.2, 5.5, 11.0),
		HitboxOffset     = CFrame.new(0, 0, -6.0),
		KnockbackSpeed   = 14.0,
		StunDuration     = 0.55,
		GuardBreak       = false,
		CausesRagdoll    = false,
	},
	['2'] = {
		Damage           = 16.0,
		PostureDamage    = 26.0,
		HitboxDelay      = 0.15,
		HitboxDuration   = 0.16,
		RecoveryDuration = 0.18,
		HitboxSize       = Vector3.new(5.2, 5.5, 11.0),
		HitboxOffset     = CFrame.new(0, 0, -6.0),
		KnockbackSpeed   = 15.0,
		StunDuration     = 0.58,
		GuardBreak       = false,
		CausesRagdoll    = false,
	},
	['3'] = {
		Damage           = 18.0,
		PostureDamage    = 30.0,
		HitboxDelay      = 0.16,
		HitboxDuration   = 0.18,
		RecoveryDuration = 0.20,
		HitboxSize       = Vector3.new(6.0, 5.8, 11.5),
		HitboxOffset     = CFrame.new(0, 0, -6.4),
		KnockbackSpeed   = 18.0,
		StunDuration     = 0.62,
		GuardBreak       = false,
		CausesRagdoll    = false,
	},
	['4'] = {
		Damage           = 27.0,
		PostureDamage    = 60.0,
		HitboxDelay      = 0.24,
		HitboxDuration   = 0.22,
		RecoveryDuration = 0.28,
		HitboxSize       = Vector3.new(7.5, 6.8, 12.5),
		HitboxOffset     = CFrame.new(0, 0, -6.8),
		KnockbackSpeed   = 84.0,
		StunDuration     = 1.35,
		GuardBreak       = true,
		CausesRagdoll    = true,
	},
	['Heavy'] = {
		Damage           = 32.0,
		PostureDamage    = 85.0,
		HitboxDelay      = 0.26,
		HitboxDuration   = 0.22,
		RecoveryDuration = 0.32,
		HitboxSize       = Vector3.new(8.0, 7.0, 13.0),
		HitboxOffset     = CFrame.new(0, 0, -7.2),
		KnockbackSpeed   = 90.0,
		StunDuration     = 1.45,
		GuardBreak       = true,
		CausesRagdoll    = true,
	},
};



return SpearSkillset;
