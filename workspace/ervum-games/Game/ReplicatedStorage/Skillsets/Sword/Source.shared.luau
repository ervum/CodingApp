--!strict

local ReplicatedStorage: ReplicatedStorage = game:GetService('ReplicatedStorage');
local ModulesFolder: Instance = ReplicatedStorage:WaitForChild('Modules');
local CombatTypes = require(ModulesFolder:WaitForChild('CombatTypes') :: ModuleScript);



export type AttackStepDescriptor = CombatTypes.AttackStepDescriptor;
export type SkillsetMap = CombatTypes.SkillsetMap;



---> Balanced Broadsword per-combo attack envelope descriptors.
local SwordSkillset: SkillsetMap = {
	['1'] = {
		Damage           = 14.0,
		PostureDamage    = 20.0,
		HitboxDelay      = 0.12,
		HitboxDuration   = 0.15,
		RecoveryDuration = 0.16,
		HitboxSize       = Vector3.new(6.5, 6.0, 7.5),
		HitboxOffset     = CFrame.new(0, 0, -4.2),
		KnockbackSpeed   = 9.0,
		StunDuration     = 0.48,
		GuardBreak       = false,
		CausesRagdoll    = false,
	},
	['2'] = {
		Damage           = 15.0,
		PostureDamage    = 22.0,
		HitboxDelay      = 0.12,
		HitboxDuration   = 0.15,
		RecoveryDuration = 0.16,
		HitboxSize       = Vector3.new(6.5, 6.0, 7.5),
		HitboxOffset     = CFrame.new(0, 0, -4.2),
		KnockbackSpeed   = 10.0,
		StunDuration     = 0.50,
		GuardBreak       = false,
		CausesRagdoll    = false,
	},
	['3'] = {
		Damage           = 16.0,
		PostureDamage    = 25.0,
		HitboxDelay      = 0.14,
		HitboxDuration   = 0.16,
		RecoveryDuration = 0.18,
		HitboxSize       = Vector3.new(7.0, 6.0, 8.0),
		HitboxOffset     = CFrame.new(0, 0, -4.5),
		KnockbackSpeed   = 14.0,
		StunDuration     = 0.55,
		GuardBreak       = false,
		CausesRagdoll    = false,
	},
	['4'] = {
		Damage           = 24.0,
		PostureDamage    = 50.0,
		HitboxDelay      = 0.22,
		HitboxDuration   = 0.20,
		RecoveryDuration = 0.26,
		HitboxSize       = Vector3.new(7.8, 7.0, 8.8),
		HitboxOffset     = CFrame.new(0, 0, -4.8),
		KnockbackSpeed   = 82.0,
		StunDuration     = 1.25,
		GuardBreak       = true,
		CausesRagdoll    = true,
	},
	['Heavy'] = {
		Damage           = 28.0,
		PostureDamage    = 75.0,
		HitboxDelay      = 0.25,
		HitboxDuration   = 0.20,
		RecoveryDuration = 0.30,
		HitboxSize       = Vector3.new(8.2, 7.2, 9.2),
		HitboxOffset     = CFrame.new(0, 0, -5.0),
		KnockbackSpeed   = 88.0,
		StunDuration     = 1.35,
		GuardBreak       = true,
		CausesRagdoll    = true,
	},
};



return SwordSkillset;
