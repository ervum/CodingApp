--!strict

export type StateValue = boolean | number | string;

export type AttackStepDescriptor = {
	Damage: number,
	PostureDamage: number,
	HitboxDelay: number,
	HitboxDuration: number,
	RecoveryDuration: number,
	HitboxSize: Vector3,
	HitboxOffset: CFrame,
	KnockbackSpeed: number,
	StunDuration: number,
	GuardBreak: boolean,
	CausesRagdoll: boolean,
};

export type SkillsetMap = { [string?]: AttackStepDescriptor };

export type WeaponDescriptor = {
	DisplayName: string,
	ModelName: string,
	HotkeyNumber: number,
	Damage: number,
	HeavyDamage: number,
	SwingCooldown: number,
	HeavyCooldown: number,
	HitboxSize: Vector3,
	HitboxOffset: CFrame,
	KnockbackForce: number,
	StunDuration: number,
	GuardBreakOnHeavy: boolean,
	AnimationSet: string,
	GripOffset: CFrame,
	AccentColor: Color3,
	ComboSkillset: SkillsetMap,
};

export type VFXPayload = {
	Target: Instance?,
	Attacker: Instance?,
	Position: Vector3?,
	OriginPosition: Vector3?,
	Direction: Vector3?,
	Damage: number?,
	PostureCost: number?,
	ComboStep: number?,
	IsHeavy: boolean?,
	IsCrit: boolean?,
	WeaponName: string?,
	StatusText: string?,
	HitstopTime: number?,
};

export type CombatActionPayload = {
	State: boolean?,
	Direction: Vector3?,
	WeaponName: string?,
	DashKey: string?,
	TargetModel: Model?,
};

export type CombatTypesModule = {
	Version: string,
};



local CombatTypes: CombatTypesModule = {
	Version = '2.1.0',
};



return CombatTypes;
