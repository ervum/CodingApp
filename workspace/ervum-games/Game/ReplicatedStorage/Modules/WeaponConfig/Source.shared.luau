--!strict

local ReplicatedStorage: ReplicatedStorage = game:GetService('ReplicatedStorage');
local ModulesFolder: Instance = ReplicatedStorage:WaitForChild('Modules');
local SkillsetsFolder: Instance = ReplicatedStorage:WaitForChild('Skillsets');

local CombatTypes = require(ModulesFolder:WaitForChild('CombatTypes') :: ModuleScript);
local BaseSkillset = require(SkillsetsFolder:WaitForChild('Base') :: ModuleScript);
local SwordSkillset = require(SkillsetsFolder:WaitForChild('Sword') :: ModuleScript);
local KatanaSkillset = require(SkillsetsFolder:WaitForChild('Katana') :: ModuleScript);
local SpearSkillset = require(SkillsetsFolder:WaitForChild('Spear') :: ModuleScript);
local BowSkillset = require(SkillsetsFolder:WaitForChild('Bow') :: ModuleScript);



export type AttackStepDescriptor = CombatTypes.AttackStepDescriptor;
export type WeaponDescriptor = CombatTypes.WeaponDescriptor;
export type WeaponCatalogModule = {
	Weapons:           { [string?]: WeaponDescriptor },
	OrderedStyles:     { [number?]: string },
	GetWeapon:         ((string?) -> (WeaponDescriptor)),
	GetAttackEnvelope: ((string?, string) -> (AttackStepDescriptor)),
};



local OrderedStyles: { [number?]: string } = {
	[1] = 'Fists',
	[2] = 'Sword',
	[3] = 'Katana',
	[4] = 'Spear',
	[5] = 'Bow',
};

local Weapons: { [string?]: WeaponDescriptor } = {
	['Fists'] = {
		DisplayName       = 'Fists',
		ModelName         = 'None',
		HotkeyNumber      = 1,
		Damage            = 10.0,
		HeavyDamage       = 20.0,
		SwingCooldown     = 0.35,
		HeavyCooldown     = 2.20,
		HitboxSize        = Vector3.new(5.5, 5.5, 5.5),
		HitboxOffset      = CFrame.new(0, 0, -3.2),
		KnockbackForce    = 35.0,
		StunDuration      = 0.45,
		GuardBreakOnHeavy = true,
		AnimationSet      = 'Fists',
		GripOffset        = CFrame.new(0, 0, 0),
		AccentColor       = Color3.fromRGB(235, 195, 85),
		ComboSkillset     = BaseSkillset,
	},
	['Sword'] = {
		DisplayName       = 'Sword',
		ModelName         = 'Sword',
		HotkeyNumber      = 2,
		Damage            = 15.0,
		HeavyDamage       = 28.0,
		SwingCooldown     = 0.44,
		HeavyCooldown     = 2.60,
		HitboxSize        = Vector3.new(6.8, 6.0, 8.0),
		HitboxOffset      = CFrame.new(0, 0, -4.4),
		KnockbackForce    = 46.0,
		StunDuration      = 0.55,
		GuardBreakOnHeavy = true,
		AnimationSet      = 'Sword',
		GripOffset        = CFrame.new(0.0, -1.0, -0.2),
		AccentColor       = Color3.fromRGB(95, 175, 255),
		ComboSkillset     = SwordSkillset,
	},
	['Katana'] = {
		DisplayName       = 'Katana',
		ModelName         = 'Katana',
		HotkeyNumber      = 3,
		Damage            = 12.0,
		HeavyDamage       = 24.0,
		SwingCooldown     = 0.30,
		HeavyCooldown     = 2.00,
		HitboxSize        = Vector3.new(6.2, 5.5, 7.5),
		HitboxOffset      = CFrame.new(0, 0, -4.2),
		KnockbackForce    = 36.0,
		StunDuration      = 0.42,
		GuardBreakOnHeavy = true,
		AnimationSet      = 'Katana',
		GripOffset        = CFrame.new(0.0, -1.0, -0.2),
		AccentColor       = Color3.fromRGB(255, 85, 125),
		ComboSkillset     = KatanaSkillset,
	},
	['Spear'] = {
		DisplayName       = 'Spear',
		ModelName         = 'Spear',
		HotkeyNumber      = 4,
		Damage            = 17.0,
		HeavyDamage       = 32.0,
		SwingCooldown     = 0.52,
		HeavyCooldown     = 3.00,
		HitboxSize        = Vector3.new(5.5, 5.8, 11.5),
		HitboxOffset      = CFrame.new(0, 0, -6.2),
		KnockbackForce    = 55.0,
		StunDuration      = 0.65,
		GuardBreakOnHeavy = true,
		AnimationSet      = 'Spear',
		GripOffset        = CFrame.new(0.0, -1.0, -0.4),
		AccentColor       = Color3.fromRGB(90, 235, 165),
		ComboSkillset     = SpearSkillset,
	},
	['Bow'] = {
		DisplayName       = 'Bow',
		ModelName         = 'Bow',
		HotkeyNumber      = 5,
		Damage            = 14.0,
		HeavyDamage       = 28.0,
		SwingCooldown     = 0.56,
		HeavyCooldown     = 2.80,
		HitboxSize        = Vector3.new(4.5, 4.5, 20.0),
		HitboxOffset      = CFrame.new(0, 0, -11.0),
		KnockbackForce    = 40.0,
		StunDuration      = 0.40,
		GuardBreakOnHeavy = true,
		AnimationSet      = 'Bow',
		GripOffset        = CFrame.new(0.0, -1.0, -0.25),
		AccentColor       = Color3.fromRGB(185, 130, 255),
		ComboSkillset     = BowSkillset,
	},
};



---> Returns the canonical <WeaponDescriptor> for a weapon style name, defaulting safely to <Fists>.
local function GetWeapon(WeaponName: string?): (WeaponDescriptor)
	local ResolvedKey: string = WeaponName or 'Fists';
	local FoundDescriptor: WeaponDescriptor? = Weapons[ResolvedKey];

	if FoundDescriptor then
		return FoundDescriptor;
	end

	local DefaultFists: WeaponDescriptor = (Weapons['Fists'] :: WeaponDescriptor);

	return DefaultFists;
end

---> Returns the consolidated <AttackStepDescriptor> for any weapon style and step key ('1', '2', '3', '4', 'Heavy').
local function GetAttackEnvelope(WeaponName: string?, StepKey: string): (AttackStepDescriptor)
	local WeaponData: WeaponDescriptor = GetWeapon(WeaponName);
	local SkillsetTable: CombatTypes.SkillsetMap = (WeaponData.ComboSkillset);
	local StepEnvelope: AttackStepDescriptor? = SkillsetTable[StepKey];

	if StepEnvelope then
		return StepEnvelope;
	end

	local FallbackEnvelope: AttackStepDescriptor = (SkillsetTable['1'] :: AttackStepDescriptor);

	return FallbackEnvelope;
end



local WeaponConfig: WeaponCatalogModule = {
	Weapons           = Weapons,
	OrderedStyles     = OrderedStyles,
	GetWeapon         = GetWeapon,
	GetAttackEnvelope = GetAttackEnvelope,
};



return WeaponConfig;
