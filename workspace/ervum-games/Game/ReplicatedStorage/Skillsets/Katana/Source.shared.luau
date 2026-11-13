--!strict

local ReplicatedStorage: ReplicatedStorage = game:GetService('ReplicatedStorage');
local ModulesFolder: Instance = ReplicatedStorage:WaitForChild('Modules');
local CombatTypes = require(ModulesFolder:WaitForChild('CombatTypes') :: ModuleScript);



export type AttackStepDescriptor = CombatTypes.AttackStepDescriptor;
export type SkillsetMap = CombatTypes.SkillsetMap;



---> High-tempo Katana per-combo attack envelope descriptors.
local KatanaSkillset: SkillsetMap = {
	['1'] = {
		Damage           = 11.0,
		PostureDamage    = 17.0,
		HitboxDelay      = 0.08,
		HitboxDuration   = 0.12,
		RecoveryDuration = 0.12,
		HitboxSize       = Vector3.new(6.0, 5.5, 7.0),
		HitboxOffset     = CFrame.new(0, 0, -4.0),
		KnockbackSpeed   = 6.0,
		StunDuration     = 0.38,
		GuardBreak       = false,
		CausesRagdoll    = false,
	},
	['2'] = {
		Damage           = 12.0,
		PostureDamage    = 18.0,
		HitboxDelay      = 0.08,
		HitboxDuration   = 0.12,
		RecoveryDuration = 0.12,
		HitboxSize       = Vector3.new(6.0, 5.5, 7.0),
		HitboxOffset     = CFrame.new(0, 0, -4.0),
		KnockbackSpeed   = 7.0,
		StunDuration     = 0.40,
		GuardBreak       = false,
		CausesRagdoll    = false,
	},
	['3'] = {
		Damage           = 13.0,
		PostureDamage    = 20.0,
		HitboxDelay      = 0.09,
		HitboxDuration   = 0.13,
		RecoveryDuration = 0.14,
		HitboxSize       = Vector3.new(6.5, 5.5, 7.5),
		HitboxOffset     = CFrame.new(0, 0, -4.2),
		KnockbackSpeed   = 10.0,
		StunDuration     = 0.45,
		GuardBreak       = false,
		CausesRagdoll    = false,
	},
	['4'] = {
		Damage           = 21.0,
		PostureDamage    = 45.0,
		HitboxDelay      = 0.15,
		HitboxDuration   = 0.16,
		RecoveryDuration = 0.22,
		HitboxSize       = Vector3.new(7.2, 6.2, 8.5),
		HitboxOffset     = CFrame.new(0, 0, -4.8),
		KnockbackSpeed   = 76.0,
		StunDuration     = 1.05,
		GuardBreak       = true,
		CausesRagdoll    = true,
	},
	['Heavy'] = {
		Damage           = 24.0,
		PostureDamage    = 65.0,
		HitboxDelay      = 0.18,
		HitboxDuration   = 0.18,
		RecoveryDuration = 0.25,
		HitboxSize       = Vector3.new(7.5, 6.5, 9.5),
		HitboxOffset     = CFrame.new(0, 0, -5.2),
		KnockbackSpeed   = 82.0,
		StunDuration     = 1.15,
		GuardBreak       = true,
		CausesRagdoll    = true,
	},
};



return KatanaSkillset;
