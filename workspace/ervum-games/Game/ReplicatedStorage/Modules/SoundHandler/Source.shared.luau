--!strict

local D: Debris = game:GetService('Debris');
local WS: Workspace = game:GetService('Workspace');



export type SoundDescriptor = {
	PrimarySoundID: string,
	AccentSoundID: string?,
	BaseVolume: number,
	MinPitch: number,
	MaxPitch: number,
	LowGain: number,
	MidGain: number,
	HighGain: number,
};

export type SoundHandlerModule = {
	SoundProfiles: { [string?]: SoundDescriptor },
	PlaySound: ((Instance | Vector3?, string) -> ()),
	PlaySwing: ((Instance?, string?, boolean?) -> ()),
	PlayImpact: ((Instance?, string?, string?, boolean?) -> ()),
};



---> Centralized combat sound descriptors using verified built-in engine audio (TimeLength > 0) with pitch and EQ shaping.
local SoundProfiles: { [string?]: SoundDescriptor } = {
	SwingFists = {
		PrimarySoundID = 'rbxasset://sounds/action_jump.mp3',
		AccentSoundID = nil,
		BaseVolume = 0.55,
		MinPitch = 1.15,
		MaxPitch = 1.35,
		LowGain = 3.0,
		MidGain = 1.5,
		HighGain = -2.0,
	},

	SwingBlade = {
		PrimarySoundID = 'rbxasset://sounds/swordslash.wav',
		AccentSoundID = nil,
		BaseVolume = 0.62,
		MinPitch = 0.92,
		MaxPitch = 1.14,
		LowGain = 1.0,
		MidGain = 2.0,
		HighGain = 3.5,
	},

	SwingHeavy = {
		PrimarySoundID = 'rbxasset://sounds/swordlunge.wav',
		AccentSoundID = 'rbxasset://sounds/action_jump.mp3',
		BaseVolume = 0.78,
		MinPitch = 0.82,
		MaxPitch = 0.98,
		LowGain = 5.0,
		MidGain = 2.0,
		HighGain = 2.5,
	},

	SwingBow = {
		PrimarySoundID = 'rbxasset://sounds/snap.mp3',
		AccentSoundID = 'rbxasset://sounds/action_jump.mp3',
		BaseVolume = 0.65,
		MinPitch = 1.08,
		MaxPitch = 1.26,
		LowGain = 1.0,
		MidGain = 2.5,
		HighGain = 4.0,
	},

	HitFists = {
		PrimarySoundID = 'rbxasset://sounds/Collide.wav',
		AccentSoundID = 'rbxasset://sounds/bass.wav',
		BaseVolume = 0.68,
		MinPitch = 0.95,
		MaxPitch = 1.15,
		LowGain = 5.5,
		MidGain = 2.0,
		HighGain = 1.0,
	},

	HitBlade = {
		PrimarySoundID = 'rbxasset://sounds/swordslash.wav',
		AccentSoundID = 'rbxasset://sounds/splat.wav',
		BaseVolume = 0.72,
		MinPitch = 1.04,
		MaxPitch = 1.22,
		LowGain = 3.5,
		MidGain = 2.5,
		HighGain = 4.0,
	},

	HitHeavy = {
		PrimarySoundID = 'rbxasset://sounds/bass.wav',
		AccentSoundID = 'rbxasset://sounds/Collide.wav',
		BaseVolume = 0.88,
		MinPitch = 0.76,
		MaxPitch = 0.92,
		LowGain = 8.0,
		MidGain = 3.0,
		HighGain = 2.0,
	},

	Block = {
		PrimarySoundID = 'rbxasset://sounds/Collide.wav',
		AccentSoundID = 'rbxasset://sounds/snap.mp3',
		BaseVolume = 0.65,
		MinPitch = 1.22,
		MaxPitch = 1.38,
		LowGain = 2.0,
		MidGain = 3.5,
		HighGain = 4.0,
	},

	Parry = {
		PrimarySoundID = 'rbxasset://sounds/unsheath.wav',
		AccentSoundID = 'rbxasset://sounds/electronicpingshort.wav',
		BaseVolume = 0.85,
		MinPitch = 1.16,
		MaxPitch = 1.32,
		LowGain = 2.5,
		MidGain = 4.0,
		HighGain = 7.5,
	},

	GuardBreak = {
		PrimarySoundID = 'rbxasset://sounds/glassbreak.wav',
		AccentSoundID = 'rbxasset://sounds/bass.wav',
		BaseVolume = 0.88,
		MinPitch = 0.86,
		MaxPitch = 1.02,
		LowGain = 7.0,
		MidGain = 3.0,
		HighGain = 5.0,
	},

	Dash = {
		PrimarySoundID = 'rbxasset://sounds/action_get_up.mp3',
		AccentSoundID = 'rbxasset://sounds/action_jump.mp3',
		BaseVolume = 0.58,
		MinPitch = 1.28,
		MaxPitch = 1.46,
		LowGain = 2.5,
		MidGain = 1.5,
		HighGain = 3.5,
	},

	Vanish = {
		PrimarySoundID = 'rbxasset://sounds/unsheath.wav',
		AccentSoundID = 'rbxasset://sounds/bass.wav',
		BaseVolume = 0.86,
		MinPitch = 1.32,
		MaxPitch = 1.48,
		LowGain = 6.5,
		MidGain = 2.5,
		HighGain = 6.0,
	},

	AirSlam = {
		PrimarySoundID = 'rbxasset://sounds/bass.wav',
		AccentSoundID = 'rbxasset://sounds/Collide.wav',
		BaseVolume = 0.92,
		MinPitch = 0.68,
		MaxPitch = 0.82,
		LowGain = 9.0,
		MidGain = 3.5,
		HighGain = 2.5,
	},

	RageAwaken = {
		PrimarySoundID = 'rbxasset://sounds/bass.wav',
		AccentSoundID = 'rbxasset://sounds/unsheath.wav',
		BaseVolume = 0.94,
		MinPitch = 0.72,
		MaxPitch = 0.86,
		LowGain = 9.5,
		MidGain = 4.0,
		HighGain = 5.5,
	},
};



local function ResolveAudioParent(TargetOrPosition: Instance | Vector3?): (Instance, Part?)
	if (typeof(TargetOrPosition) == 'Instance') then
		local TargetInstance: Instance = (TargetOrPosition :: Instance);

		if TargetInstance:IsA('Model') then
			local RootPart: BasePart? = (TargetInstance:FindFirstChild('HumanoidRootPart') :: BasePart?) or (TargetInstance.PrimaryPart) or TargetInstance:FindFirstChildWhichIsA('BasePart');

			if RootPart then
				return RootPart, nil;
			end
		elseif TargetInstance:IsA('BasePart') then
			return TargetInstance, nil;
		end
	elseif (typeof(TargetOrPosition) == 'Vector3') then
		local WorldPos: Vector3 = (TargetOrPosition :: Vector3);
		local SoundAnchor: Part = Instance.new('Part');
		SoundAnchor.Name = 'CombatAudioAnchor';
		SoundAnchor.Size = Vector3.new(0.2, 0.2, 0.2);
		SoundAnchor.Transparency = 1.0;
		SoundAnchor.Anchored = true;
		SoundAnchor.CanCollide = false;
		SoundAnchor.CanQuery = false;
		SoundAnchor.CanTouch = false;
		SoundAnchor.Massless = true;
		SoundAnchor.Position = WorldPos;
		SoundAnchor.Parent = WS;

		return SoundAnchor, SoundAnchor;
	end

	return WS, nil;
end

local function EmitSingleSound(AudioParent: Instance, SoundID: string, Volume: number, Pitch: number, Profile: SoundDescriptor): ()
	local SoundInstance: Sound = Instance.new('Sound');
	SoundInstance.Name = 'CombatSFX';
	SoundInstance.SoundId = SoundID;
	SoundInstance.Volume = Volume;
	SoundInstance.PlaybackSpeed = Pitch;
	SoundInstance.RollOffMaxDistance = 120.0;
	SoundInstance.RollOffMinDistance = 8.0;

	local EqualizerFX: EqualizerSoundEffect = Instance.new('EqualizerSoundEffect');
	EqualizerFX.LowGain = (Profile.LowGain);
	EqualizerFX.MidGain = (Profile.MidGain);
	EqualizerFX.HighGain = (Profile.HighGain);
	EqualizerFX.Parent = SoundInstance;

	SoundInstance.Parent = AudioParent;
	SoundInstance:Play();

	D:AddItem(SoundInstance, 2.4);

	return;
end

---> Plays a pitch-varied and equalized combat sound effect from <SoundProfiles>.
local function PlaySound(TargetOrPosition: Instance | Vector3?, SoundKey: string): ()
	local Profile: SoundDescriptor? = SoundProfiles[SoundKey];

	if not Profile then return end

	local SafeProfile: SoundDescriptor = (Profile :: SoundDescriptor);
	local AudioParent: Instance, TemporaryAnchor: Part? = ResolveAudioParent(TargetOrPosition);
	local RandomAlpha: number = ((math.random(0, 1000)) / 1000.0);
	local ResolvedPitch: number = ((SafeProfile.MinPitch) + (((SafeProfile.MaxPitch) - (SafeProfile.MinPitch)) * RandomAlpha));

	EmitSingleSound(AudioParent, (SafeProfile.PrimarySoundID), (SafeProfile.BaseVolume), ResolvedPitch, SafeProfile);

	if (SafeProfile.AccentSoundID) then
		local AccentPitch: number = (ResolvedPitch * 1.06);
		local AccentVolume: number = ((SafeProfile.BaseVolume) * 0.65);
		EmitSingleSound(AudioParent, (SafeProfile.AccentSoundID :: string), AccentVolume, AccentPitch, SafeProfile);
	end

	if TemporaryAnchor then
		D:AddItem(TemporaryAnchor, 2.5);
	end

	return;
end

---> Plays a weapon-matched swing whoosh sound for M1 or Heavy attacks.
local function PlaySwing(Attacker: Instance?, WeaponName: string?, IsHeavy: boolean?): ()
	local ResolvedWeapon: string = WeaponName or 'Fists';

	if (IsHeavy == true) then
		PlaySound(Attacker, 'SwingHeavy');

		return;
	end

	if (ResolvedWeapon == 'Bow') then
		PlaySound(Attacker, 'SwingBow');
	elseif (ResolvedWeapon == 'Fists') then
		PlaySound(Attacker, 'SwingFists');
	else
		PlaySound(Attacker, 'SwingBlade');
	end

	return;
end

---> Plays a weapon-matched impact sound for clean hits, blocks, parries, guard breaks, or vanish strikes.
local function PlayImpact(TargetEntity: Instance?, ImpactKind: string?, WeaponName: string?, IsHeavy: boolean?): ()
	local ResolvedKind: string = ImpactKind or 'Hit';
	local ResolvedWeapon: string = WeaponName or 'Fists';

	if (ResolvedKind == 'Parry') then
		PlaySound(TargetEntity, 'Parry');
	elseif (ResolvedKind == 'GuardBreak') then
		PlaySound(TargetEntity, 'GuardBreak');
	elseif (ResolvedKind == 'Block') then
		PlaySound(TargetEntity, 'Block');
	elseif (ResolvedKind == 'Vanish') then
		PlaySound(TargetEntity, 'Vanish');
	elseif (IsHeavy == true) then
		PlaySound(TargetEntity, 'HitHeavy');
	elseif (ResolvedWeapon == 'Fists') then
		PlaySound(TargetEntity, 'HitFists');
	else
		PlaySound(TargetEntity, 'HitBlade');
	end

	return;
end



local SoundHandler: SoundHandlerModule = {
	SoundProfiles = SoundProfiles,
	PlaySound = PlaySound,
	PlaySwing = PlaySwing,
	PlayImpact = PlayImpact,
};



return SoundHandler;
