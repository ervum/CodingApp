--!strict

export type ComboAnimationMap = { [number?]: string };
export type DirectionalAnimationMap = { [string?]: string };

export type AnimationRegistryDescriptor = {
	Fists: ComboAnimationMap,
	Sword: ComboAnimationMap,
	Katana: ComboAnimationMap,
	Spear: ComboAnimationMap,
	Bow: ComboAnimationMap,
	HeavyAttack: string,
	AirSlam: string,
	Block: string,
	Parry: string,
	Dash: DirectionalAnimationMap,
	WallClimb: string,
	WallRunLeft: string,
	WallRunRight: string,
	Glider: string,
	RageAwaken: string,
};



---> Centralized single source of truth for all combat and traversal animation AssetIDs and procedural sequences.
local AnimationRegistry: AnimationRegistryDescriptor = {
	Fists = {
		[1] = 'procedural://FistCombo1',
		[2] = 'procedural://FistCombo2',
		[3] = 'procedural://FistCombo3',
		[4] = 'procedural://FistCombo4',
	},

	Sword = {
		[1] = 'rbxassetid://522635514',
		[2] = 'rbxassetid://522635514',
		[3] = 'rbxassetid://522635514',
		[4] = 'rbxassetid://522638767',
	},

	Katana = {
		[1] = 'rbxassetid://522635514',
		[2] = 'rbxassetid://522635514',
		[3] = 'rbxassetid://522635514',
		[4] = 'rbxassetid://522638767',
	},

	Spear = {
		[1] = 'rbxassetid://522635514',
		[2] = 'rbxassetid://522635514',
		[3] = 'rbxassetid://522635514',
		[4] = 'rbxassetid://522638767',
	},

	Bow = {
		[1] = 'procedural://BowShot1',
		[2] = 'procedural://BowShot2',
		[3] = 'procedural://BowShot3',
		[4] = 'procedural://BowShot4',
	},

	HeavyAttack = 'rbxassetid://522638767',
	AirSlam = 'rbxassetid://522638767',
	Block = 'rbxassetid://507770818',
	Parry = 'rbxassetid://522635514',

	Dash = {
		Forward = 'rbxassetid://507765000',
		Backward = 'rbxassetid://507765000',
		Left = 'rbxassetid://507765000',
		Right = 'rbxassetid://507765000',
	},

	WallClimb = 'rbxassetid://507765644',
	WallRunLeft = 'rbxassetid://507765000',
	WallRunRight = 'rbxassetid://507765000',
	Glider = 'rbxassetid://507766388',
	RageAwaken = 'rbxassetid://507770239',
};



return AnimationRegistry;
