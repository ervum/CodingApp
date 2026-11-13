--!strict

local RS: RunService = game:GetService('RunService');
local TS: TweenService = game:GetService('TweenService');



export type TrackDictionary = { [string?]: AnimationTrack };
export type MotorRestMap = { [string?]: CFrame };

export type PoseKeyframe = {
	RootJoint:     CFrame?,
	Neck:          CFrame?,
	RightShoulder: CFrame?,
	LeftShoulder:  CFrame?,
	RightHip:      CFrame?,
	LeftHip:       CFrame?,
	RightElbow:    number?,
	LeftElbow:     number?,
};

export type PoseDefinition = {
	Windup:        PoseKeyframe?,
	Strike:        PoseKeyframe,
	FollowThrough: PoseKeyframe?,
	Duration:      number,
	HoldPose:      boolean,
	StrikeEasing:  Enum.EasingStyle?,
};

export type AnimationHandlerModule = {
	PlayAnimation:      ((Model, string, Enum.AnimationPriority?, number?, string?) -> (AnimationTrack?)),
	PlayProceduralPose: ((Model, string, number?) -> ()),
	StopProceduralPose: ((Model, number?) -> ()),
	StopAnimation:      ((Model, string, number?) -> ()),
	StopAllCombat:      ((Model) -> ()),
	ApplyHitstop:       ((Model, number) -> ()),
	CleanupCache:       ((Model) -> ()),
};



local LoadedTracks: { [Model?]: TrackDictionary } = { };
local HitstopTokens: { [Model?]: number } = { };
local ProceduralTokens: { [Model?]: number } = { };
local ActiveProceduralCharacters: { [Model?]: boolean } = { };
local CachedRestC0Map: { [Model?]: MotorRestMap } = { };

local DefaultR6RestC0: MotorRestMap = {
	['RootJoint']      = (CFrame.new(0.0, 0.0, 0.0) * CFrame.Angles(math.rad(-90.0), 0.0, math.rad(-180.0))),
	['Neck']           = (CFrame.new(0.0, 1.0, 0.0) * CFrame.Angles(math.rad(-90.0), 0.0, math.rad(-180.0))),
	['Right Shoulder'] = (CFrame.new(1.0, 0.5, 0.0) * CFrame.Angles(0.0, math.rad(90.0), 0.0)),
	['Left Shoulder']  = (CFrame.new(-1.0, 0.5, 0.0) * CFrame.Angles(0.0, math.rad(-90.0), 0.0)),
	['Right Hip']      = (CFrame.new(1.0, -1.0, 0.0) * CFrame.Angles(0.0, math.rad(90.0), 0.0)),
	['Left Hip']       = (CFrame.new(-1.0, -1.0, 0.0) * CFrame.Angles(0.0, math.rad(-90.0), 0.0)),
};

local BoxingGuardKeyframe: PoseKeyframe = {
	RootJoint     = CFrame.Angles(math.rad(-6.0), 0.0, math.rad(-14.0)),
	Neck          = CFrame.Angles(math.rad(6.0), 0.0, math.rad(14.0)),
	RightShoulder = (CFrame.new(-0.12, -0.05, 0.0) * CFrame.Angles(math.rad(18.0), math.rad(-26.0), math.rad(78.0))),
	LeftShoulder  = (CFrame.new(0.18, -0.05, 0.0) * CFrame.Angles(math.rad(18.0), math.rad(28.0), math.rad(-84.0))),
	RightElbow    = 72.0,
	LeftElbow     = 76.0,
};

local PoseLibrary: { [string?]: PoseDefinition } = {
	---> Custom Martial Arts / Boxing 4-Hit Fist Combo & Heavy Haymaker
	FistCombo1 = {
		Windup = {
			RootJoint     = (CFrame.new(0.0, 0.08, 0.0) * CFrame.Angles(math.rad(4.0), 0.0, math.rad(-32.0))),
			Neck          = CFrame.Angles(0.0, 0.0, math.rad(28.0)),
			RightShoulder = (CFrame.new(0.22, -0.1, 0.0) * CFrame.Angles(math.rad(-12.0), math.rad(15.0), math.rad(-25.0))),
			LeftShoulder  = (CFrame.new(0.20, 0.05, 0.0) * CFrame.Angles(math.rad(24.0), math.rad(32.0), math.rad(-92.0))),
			RightElbow    = 78.0,
			LeftElbow     = 82.0,
		},
		Strike = {
			RootJoint     = (CFrame.new(0.0, -0.38, 0.0) * CFrame.Angles(math.rad(-14.0), 0.0, math.rad(44.0))),
			Neck          = CFrame.Angles(math.rad(12.0), 0.0, math.rad(-40.0)),
			RightShoulder = (CFrame.new(-0.42, -0.12, -0.22) * CFrame.Angles(math.rad(15.0), math.rad(-22.0), math.rad(96.0))),
			LeftShoulder  = (CFrame.new(0.18, -0.08, 0.0) * CFrame.Angles(math.rad(22.0), math.rad(34.0), math.rad(-78.0))),
			RightHip      = CFrame.Angles(0.0, 0.0, math.rad(-22.0)),
			LeftHip       = CFrame.Angles(0.0, 0.0, math.rad(-18.0)),
			RightElbow    = 8.0,
			LeftElbow     = 85.0,
		},
		FollowThrough = BoxingGuardKeyframe,
		Duration      = 0.30,
		HoldPose      = false,
		StrikeEasing  = (Enum.EasingStyle.Back),
	},

	FistCombo2 = {
		Windup = {
			RootJoint     = (CFrame.new(0.0, 0.08, 0.0) * CFrame.Angles(math.rad(4.0), 0.0, math.rad(34.0))),
			Neck          = CFrame.Angles(0.0, 0.0, math.rad(-30.0)),
			RightShoulder = (CFrame.new(-0.20, 0.05, 0.0) * CFrame.Angles(math.rad(24.0), math.rad(-32.0), math.rad(92.0))),
			LeftShoulder  = (CFrame.new(-0.22, -0.1, 0.0) * CFrame.Angles(math.rad(-12.0), math.rad(-15.0), math.rad(25.0))),
			RightElbow    = 82.0,
			LeftElbow     = 78.0,
		},
		Strike = {
			RootJoint     = (CFrame.new(0.0, -0.42, 0.0) * CFrame.Angles(math.rad(-15.0), 0.0, math.rad(-46.0))),
			Neck          = CFrame.Angles(math.rad(12.0), 0.0, math.rad(42.0)),
			RightShoulder = (CFrame.new(-0.18, -0.08, 0.0) * CFrame.Angles(math.rad(22.0), math.rad(-34.0), math.rad(78.0))),
			LeftShoulder  = (CFrame.new(0.44, -0.12, -0.22) * CFrame.Angles(math.rad(15.0), math.rad(22.0), math.rad(-98.0))),
			RightHip      = CFrame.Angles(0.0, 0.0, math.rad(18.0)),
			LeftHip       = CFrame.Angles(0.0, 0.0, math.rad(22.0)),
			RightElbow    = 85.0,
			LeftElbow     = 8.0,
		},
		FollowThrough = BoxingGuardKeyframe,
		Duration      = 0.30,
		HoldPose      = false,
		StrikeEasing  = (Enum.EasingStyle.Back),
	},

	FistCombo3 = {
		Windup = {
			RootJoint     = (CFrame.new(0.0, 0.12, 0.0) * CFrame.Angles(math.rad(6.0), 0.0, math.rad(-52.0))),
			Neck          = CFrame.Angles(0.0, 0.0, math.rad(44.0)),
			RightShoulder = (CFrame.new(0.15, 0.05, 0.0) * CFrame.Angles(math.rad(-25.0), math.rad(42.0), math.rad(88.0))),
			LeftShoulder  = (CFrame.new(0.20, -0.05, 0.0) * CFrame.Angles(math.rad(25.0), math.rad(30.0), math.rad(-85.0))),
			RightElbow    = 55.0,
			LeftElbow     = 80.0,
		},
		Strike = {
			RootJoint     = (CFrame.new(0.0, -0.40, 0.0) * CFrame.Angles(math.rad(-16.0), math.rad(-6.0), math.rad(56.0))),
			Neck          = CFrame.Angles(math.rad(14.0), 0.0, math.rad(-48.0)),
			RightShoulder = (CFrame.new(-0.38, 0.0, -0.28) * CFrame.Angles(math.rad(32.0), math.rad(-42.0), math.rad(95.0))),
			LeftShoulder  = (CFrame.new(0.15, -0.1, 0.0) * CFrame.Angles(math.rad(18.0), math.rad(25.0), math.rad(-65.0))),
			RightHip      = CFrame.Angles(0.0, 0.0, math.rad(-26.0)),
			LeftHip       = CFrame.Angles(0.0, 0.0, math.rad(-20.0)),
			RightElbow    = 38.0,
			LeftElbow     = 78.0,
		},
		FollowThrough = BoxingGuardKeyframe,
		Duration      = 0.32,
		HoldPose      = false,
		StrikeEasing  = (Enum.EasingStyle.Back),
	},

	FistCombo4 = {
		Windup = {
			RootJoint     = (CFrame.new(0.0, 0.10, -0.42) * CFrame.Angles(math.rad(-18.0), 0.0, math.rad(-48.0))),
			Neck          = CFrame.Angles(math.rad(15.0), 0.0, math.rad(42.0)),
			RightShoulder = (CFrame.new(0.18, -0.25, 0.0) * CFrame.Angles(math.rad(-20.0), math.rad(15.0), math.rad(35.0))),
			LeftShoulder  = (CFrame.new(0.20, 0.0, 0.0) * CFrame.Angles(math.rad(22.0), math.rad(28.0), math.rad(-82.0))),
			RightHip      = CFrame.Angles(0.0, 0.0, math.rad(28.0)),
			LeftHip       = CFrame.Angles(0.0, 0.0, math.rad(-28.0)),
			RightElbow    = 85.0,
			LeftElbow     = 75.0,
		},
		Strike = {
			RootJoint     = (CFrame.new(0.0, -0.44, 0.22) * CFrame.Angles(math.rad(14.0), 0.0, math.rad(54.0))),
			Neck          = CFrame.Angles(math.rad(-14.0), 0.0, math.rad(-46.0)),
			RightShoulder = (CFrame.new(-0.36, 0.22, -0.25) * CFrame.Angles(math.rad(24.0), math.rad(-26.0), math.rad(142.0))),
			LeftShoulder  = (CFrame.new(0.15, -0.15, 0.0) * CFrame.Angles(math.rad(20.0), math.rad(22.0), math.rad(-58.0))),
			RightHip      = CFrame.Angles(0.0, 0.0, math.rad(-32.0)),
			LeftHip       = CFrame.Angles(0.0, 0.0, math.rad(24.0)),
			RightElbow    = 24.0,
			LeftElbow     = 72.0,
		},
		FollowThrough = BoxingGuardKeyframe,
		Duration      = 0.38,
		HoldPose      = false,
		StrikeEasing  = (Enum.EasingStyle.Back),
	},

	FistHeavy = {
		Windup = {
			RootJoint     = (CFrame.new(0.0, 0.20, -0.20) * CFrame.Angles(math.rad(16.0), 0.0, math.rad(-42.0))),
			Neck          = CFrame.Angles(math.rad(-12.0), 0.0, math.rad(36.0)),
			RightShoulder = (CFrame.new(0.25, 0.15, 0.0) * CFrame.Angles(math.rad(-28.0), math.rad(25.0), math.rad(145.0))),
			LeftShoulder  = (CFrame.new(0.20, 0.05, 0.0) * CFrame.Angles(math.rad(20.0), math.rad(30.0), math.rad(-95.0))),
			RightElbow    = 65.0,
			LeftElbow     = 75.0,
		},
		Strike = {
			RootJoint     = (CFrame.new(0.0, -0.48, 0.0) * CFrame.Angles(math.rad(-20.0), 0.0, math.rad(48.0))),
			Neck          = CFrame.Angles(math.rad(16.0), 0.0, math.rad(-42.0)),
			RightShoulder = (CFrame.new(-0.46, -0.15, -0.26) * CFrame.Angles(math.rad(22.0), math.rad(-24.0), math.rad(92.0))),
			LeftShoulder  = (CFrame.new(0.32, -0.12, -0.15) * CFrame.Angles(math.rad(18.0), math.rad(24.0), math.rad(-86.0))),
			RightHip      = CFrame.Angles(0.0, 0.0, math.rad(-28.0)),
			LeftHip       = CFrame.Angles(0.0, 0.0, math.rad(-22.0)),
			RightElbow    = 10.0,
			LeftElbow     = 35.0,
		},
		FollowThrough = BoxingGuardKeyframe,
		Duration      = 0.40,
		HoldPose      = false,
		StrikeEasing  = (Enum.EasingStyle.Back),
	},

	---> Weapon (Sword / Katana / Spear) Combo Poses
	Combo1 = {
		Windup = {
			RootJoint     = CFrame.Angles(0.0, 0.0, math.rad(-26.0)),
			RightShoulder = CFrame.Angles(math.rad(-18.0), 0.0, math.rad(118.0)),
			LeftShoulder  = CFrame.Angles(0.0, 0.0, math.rad(-28.0)),
			RightElbow    = 45.0,
		},
		Strike = {
			RootJoint     = (CFrame.new(0.0, -0.28, 0.0) * CFrame.Angles(math.rad(-10.0), 0.0, math.rad(34.0))),
			RightShoulder = (CFrame.new(-0.28, 0.0, 0.0) * CFrame.Angles(math.rad(28.0), math.rad(-24.0), math.rad(78.0))),
			LeftShoulder  = CFrame.Angles(0.0, 0.0, math.rad(-42.0)),
			RightElbow    = 12.0,
		},
		FollowThrough = nil,
		Duration      = 0.25,
		HoldPose      = false,
		StrikeEasing  = (Enum.EasingStyle.Quad),
	},

	Combo2 = {
		Windup = {
			RootJoint     = CFrame.Angles(0.0, 0.0, math.rad(28.0)),
			RightShoulder = CFrame.Angles(0.0, math.rad(28.0), math.rad(62.0)),
			LeftShoulder  = CFrame.Angles(math.rad(-15.0), 0.0, math.rad(-95.0)),
			RightElbow    = 50.0,
		},
		Strike = {
			RootJoint     = (CFrame.new(0.0, -0.28, 0.0) * CFrame.Angles(math.rad(-10.0), 0.0, math.rad(-34.0))),
			RightShoulder = (CFrame.new(-0.28, 0.0, 0.0) * CFrame.Angles(0.0, math.rad(-22.0), math.rad(98.0))),
			LeftShoulder  = CFrame.Angles(math.rad(22.0), math.rad(18.0), math.rad(-75.0)),
			RightElbow    = 10.0,
		},
		FollowThrough = nil,
		Duration      = 0.25,
		HoldPose      = false,
		StrikeEasing  = (Enum.EasingStyle.Quad),
	},

	Combo3 = {
		Windup = {
			RootJoint     = CFrame.Angles(math.rad(8.0), 0.0, math.rad(-36.0)),
			RightShoulder = CFrame.Angles(math.rad(-25.0), 0.0, math.rad(148.0)),
			LeftShoulder  = CFrame.Angles(0.0, 0.0, math.rad(-65.0)),
			RightElbow    = 40.0,
		},
		Strike = {
			RootJoint     = (CFrame.new(0.0, -0.32, 0.0) * CFrame.Angles(math.rad(-12.0), 0.0, math.rad(40.0))),
			RightShoulder = (CFrame.new(-0.30, 0.0, 0.0) * CFrame.Angles(math.rad(30.0), math.rad(-28.0), math.rad(58.0))),
			LeftShoulder  = CFrame.Angles(0.0, 0.0, math.rad(-85.0)),
			RightElbow    = 10.0,
		},
		FollowThrough = nil,
		Duration      = 0.27,
		HoldPose      = false,
		StrikeEasing  = (Enum.EasingStyle.Quad),
	},

	Combo4 = {
		Windup = {
			RootJoint     = CFrame.Angles(math.rad(12.0), 0.0, math.rad(-44.0)),
			RightShoulder = CFrame.Angles(math.rad(-30.0), 0.0, math.rad(160.0)),
			LeftShoulder  = CFrame.Angles(math.rad(-20.0), 0.0, math.rad(-125.0)),
			RightElbow    = 48.0,
		},
		Strike = {
			RootJoint     = (CFrame.new(0.0, -0.38, 0.0) * CFrame.Angles(math.rad(-16.0), 0.0, math.rad(48.0))),
			RightShoulder = (CFrame.new(-0.36, 0.0, 0.0) * CFrame.Angles(math.rad(35.0), math.rad(-25.0), math.rad(96.0))),
			LeftShoulder  = CFrame.Angles(math.rad(25.0), math.rad(20.0), math.rad(-90.0)),
			RightElbow    = 8.0,
		},
		FollowThrough = nil,
		Duration      = 0.34,
		HoldPose      = false,
		StrikeEasing  = (Enum.EasingStyle.Back),
	},

	Heavy = {
		Windup = {
			RootJoint     = CFrame.Angles(math.rad(14.0), 0.0, math.rad(-46.0)),
			RightShoulder = CFrame.Angles(math.rad(-35.0), 0.0, math.rad(168.0)),
			LeftShoulder  = CFrame.Angles(math.rad(-25.0), 0.0, math.rad(-140.0)),
			RightElbow    = 52.0,
		},
		Strike = {
			RootJoint     = (CFrame.new(0.0, -0.40, 0.0) * CFrame.Angles(math.rad(-18.0), 0.0, math.rad(45.0))),
			RightShoulder = (CFrame.new(-0.38, 0.0, 0.0) * CFrame.Angles(math.rad(38.0), math.rad(-22.0), math.rad(72.0))),
			LeftShoulder  = CFrame.Angles(math.rad(22.0), math.rad(15.0), math.rad(-75.0)),
			RightElbow    = 8.0,
		},
		FollowThrough = nil,
		Duration      = 0.38,
		HoldPose      = false,
		StrikeEasing  = (Enum.EasingStyle.Back),
	},

	AirSlam = {
		Windup = {
			RootJoint     = CFrame.Angles(math.rad(15.0), 0.0, 0.0),
			RightShoulder = CFrame.Angles(0.0, 0.0, math.rad(170.0)),
			LeftShoulder  = CFrame.Angles(0.0, 0.0, math.rad(-170.0)),
		},
		Strike = {
			RootJoint     = CFrame.Angles(math.rad(-22.0), 0.0, 0.0),
			RightShoulder = CFrame.Angles(math.rad(30.0), 0.0, math.rad(55.0)),
			LeftShoulder  = CFrame.Angles(math.rad(30.0), 0.0, math.rad(-55.0)),
		},
		FollowThrough = nil,
		Duration      = 0.42,
		HoldPose      = false,
		StrikeEasing  = (Enum.EasingStyle.Quad),
	},

	Block = {
		Windup = nil,
		Strike = {
			RootJoint     = CFrame.Angles(math.rad(-4.0), 0.0, math.rad(-14.0)),
			RightShoulder = CFrame.Angles(math.rad(32.0), math.rad(-28.0), math.rad(95.0)),
			LeftShoulder  = CFrame.Angles(math.rad(28.0), math.rad(28.0), math.rad(-95.0)),
			RightElbow    = 75.0,
			LeftElbow     = 75.0,
		},
		FollowThrough = nil,
		Duration      = 0.12,
		HoldPose      = true,
		StrikeEasing  = (Enum.EasingStyle.Quad),
	},

	Parry = {
		Windup = {
			RootJoint     = CFrame.Angles(0.0, 0.0, math.rad(-20.0)),
			RightShoulder = CFrame.Angles(math.rad(35.0), math.rad(-30.0), math.rad(100.0)),
		},
		Strike = {
			RootJoint     = CFrame.Angles(0.0, 0.0, math.rad(32.0)),
			RightShoulder = CFrame.Angles(math.rad(-25.0), math.rad(25.0), math.rad(115.0)),
			LeftShoulder  = CFrame.Angles(0.0, 0.0, math.rad(-55.0)),
		},
		FollowThrough = nil,
		Duration      = 0.24,
		HoldPose      = false,
		StrikeEasing  = (Enum.EasingStyle.Back),
	},

	Dash = {
		Windup = nil,
		Strike = {
			RootJoint     = CFrame.Angles(math.rad(-14.0), 0.0, 0.0),
			RightShoulder = CFrame.Angles(0.0, 0.0, math.rad(-48.0)),
			LeftShoulder  = CFrame.Angles(0.0, 0.0, math.rad(48.0)),
			RightHip      = CFrame.Angles(0.0, 0.0, math.rad(32.0)),
			LeftHip       = CFrame.Angles(0.0, 0.0, math.rad(-28.0)),
		},
		FollowThrough = nil,
		Duration      = 0.22,
		HoldPose      = false,
		StrikeEasing  = (Enum.EasingStyle.Quad),
	},

	HitFlinch = {
		Windup = nil,
		Strike = {
			RootJoint     = CFrame.Angles(math.rad(16.0), 0.0, math.rad(12.0)),
			Neck          = CFrame.Angles(math.rad(18.0), 0.0, math.rad(-10.0)),
			RightShoulder = CFrame.Angles(0.0, 0.0, math.rad(38.0)),
			LeftShoulder  = CFrame.Angles(0.0, 0.0, math.rad(-38.0)),
		},
		FollowThrough = nil,
		Duration      = 0.20,
		HoldPose      = false,
		StrikeEasing  = (Enum.EasingStyle.Quad),
	},

	RageAwaken = {
		Windup = {
			RootJoint     = CFrame.Angles(math.rad(-12.0), 0.0, 0.0),
			RightShoulder = CFrame.Angles(math.rad(35.0), 0.0, math.rad(85.0)),
			LeftShoulder  = CFrame.Angles(math.rad(35.0), 0.0, math.rad(-85.0)),
		},
		Strike = {
			RootJoint     = CFrame.Angles(math.rad(16.0), 0.0, 0.0),
			Neck          = CFrame.Angles(math.rad(-20.0), 0.0, 0.0),
			RightShoulder = CFrame.Angles(math.rad(-25.0), 0.0, math.rad(135.0)),
			LeftShoulder  = CFrame.Angles(math.rad(-25.0), 0.0, math.rad(-135.0)),
		},
		FollowThrough = nil,
		Duration      = 0.45,
		HoldPose      = false,
		StrikeEasing  = (Enum.EasingStyle.Back),
	},

	Glider = {
		Windup = nil,
		Strike = {
			RightShoulder = CFrame.Angles(0.0, 0.0, math.rad(165.0)),
			LeftShoulder  = CFrame.Angles(0.0, 0.0, math.rad(-165.0)),
		},
		FollowThrough = nil,
		Duration      = 0.16,
		HoldPose      = true,
		StrikeEasing  = (Enum.EasingStyle.Quad),
	},
};



local function GetOrCreateAnimator(Humanoid: Humanoid): (Animator)
	local ExistingAnimator: Animator? = Humanoid:FindFirstChildOfClass('Animator');

	if ExistingAnimator then
		return ExistingAnimator;
	end

	local NewAnimator: Animator = Instance.new('Animator');
	NewAnimator.Parent = Humanoid;

	return NewAnimator;
end

local function IsR15Character(Character: Model): (boolean)
	return (Character:FindFirstChild('UpperTorso') ~= nil);
end

local function FindCharacterMotor(Character: Model, CanonicalSlot: string): (Motor6D?)
	if IsR15Character(Character) then
		local R15NameMap: { [string]: string } = {
			['RootJoint']      = 'Waist',
			['Neck']           = 'Neck',
			['Right Shoulder'] = 'RightShoulder',
			['Left Shoulder']  = 'LeftShoulder',
			['Right Hip']      = 'RightHip',
			['Left Hip']       = 'LeftHip',
			['RightElbow']     = 'RightElbow',
			['LeftElbow']      = 'LeftElbow',
		};

		local TargetMotorName: string = R15NameMap[CanonicalSlot] or CanonicalSlot;

		for _: number, DescendantObject: Instance in Character:GetDescendants() do
			if DescendantObject:IsA('Motor6D') and (DescendantObject.Name == TargetMotorName) then
				return DescendantObject;
			end
		end

		return nil;
	end

	local RootPart: Instance? = Character:FindFirstChild('HumanoidRootPart');
	local TorsoPart: Instance? = Character:FindFirstChild('Torso');

	if (CanonicalSlot == 'RootJoint') and RootPart then
		local RootMotor: Instance? = RootPart:FindFirstChild('RootJoint') or RootPart:FindFirstChild('TorsoJoint');

		if RootMotor and RootMotor:IsA('Motor6D') then
			return RootMotor;
		end
	end

	if TorsoPart then
		local TorsoMotor: Instance? = TorsoPart:FindFirstChild(CanonicalSlot);

		if TorsoMotor and TorsoMotor:IsA('Motor6D') then
			return TorsoMotor;
		end
	end

	for _: number, DescendantObject: Instance in Character:GetDescendants() do
		if DescendantObject:IsA('Motor6D') and (DescendantObject.Name == CanonicalSlot) then
			return DescendantObject;
		end
	end

	return nil;
end

local function EnsureRestC0Map(Character: Model): (MotorRestMap)
	local ExistingMap: MotorRestMap? = CachedRestC0Map[Character];

	if ExistingMap then
		return ExistingMap;
	end

	local NewMap: MotorRestMap = { };
	local SlotNames: { [number?]: string } = {
		[1] = 'RootJoint',
		[2] = 'Neck',
		[3] = 'Right Shoulder',
		[4] = 'Left Shoulder',
		[5] = 'Right Hip',
		[6] = 'Left Hip',
		[7] = 'RightElbow',
		[8] = 'LeftElbow',
	};

	for _: number?, SlotKey: string in SlotNames do
		local FoundMotor: Motor6D? = FindCharacterMotor(Character, SlotKey);

		if FoundMotor then
			NewMap[SlotKey] = (FoundMotor.C0);
		elseif DefaultR6RestC0[SlotKey] then
			NewMap[SlotKey] = (DefaultR6RestC0[SlotKey] :: CFrame);
		end
	end

	CachedRestC0Map[Character] = NewMap;

	return NewMap;
end

local function ConvertR6OffsetToR15(CanonicalSlot: string, R6Offset: CFrame): (CFrame)
	local PosX: number = (R6Offset.X);
	local PosY: number = (R6Offset.Y);
	local PosZ: number = (R6Offset.Z);
	local RotX: number, RotY: number, RotZ: number = R6Offset:ToEulerAnglesXYZ();

	if (CanonicalSlot == 'RootJoint') or (CanonicalSlot == 'Neck') then
		return (CFrame.new(PosX, PosZ, PosY) * CFrame.Angles(RotX, RotZ, (-RotY)));
	elseif (CanonicalSlot == 'Right Shoulder') then
		return (CFrame.new((-PosZ), PosY, PosX) * CFrame.Angles(RotZ, RotY, (-RotX)));
	elseif (CanonicalSlot == 'Left Shoulder') then
		return (CFrame.new(PosZ, PosY, (-PosX)) * CFrame.Angles((-RotZ), RotY, RotX));
	elseif (CanonicalSlot == 'Right Hip') then
		return CFrame.Angles(RotZ, RotY, (-RotX));
	elseif (CanonicalSlot == 'Left Hip') then
		return CFrame.Angles((-RotZ), RotY, RotX);
	end

	return R6Offset;
end

local function ApplyPoseKeyframe(Character: Model, Keyframe: PoseKeyframe, TweenDuration: number, EasingStyleOverride: Enum.EasingStyle?): ()
	local RestMap: MotorRestMap = EnsureRestC0Map(Character);
	local ResolvedStyle: Enum.EasingStyle = EasingStyleOverride or (Enum.EasingStyle.Quad);
	local Info: TweenInfo = TweenInfo.new(math.max(0.035, TweenDuration), ResolvedStyle, (Enum.EasingDirection.Out));
	local IsR15: boolean = IsR15Character(Character);

	local MotorTargets: { [string]: CFrame? } = {
		['RootJoint']      = (Keyframe.RootJoint),
		['Neck']           = (Keyframe.Neck),
		['Right Shoulder'] = (Keyframe.RightShoulder),
		['Left Shoulder']  = (Keyframe.LeftShoulder),
		['Right Hip']      = (Keyframe.RightHip),
		['Left Hip']       = (Keyframe.LeftHip),
	};

	for SlotName: string, OffsetCF: CFrame? in MotorTargets do
		local MotorInstance: Motor6D? = FindCharacterMotor(Character, SlotName);
		local BaseC0: CFrame? = RestMap[SlotName] or DefaultR6RestC0[SlotName];

		if MotorInstance and BaseC0 then
			local ResolvedDelta: CFrame = CFrame.identity;

			if OffsetCF then
				ResolvedDelta = IsR15 and ConvertR6OffsetToR15(SlotName, OffsetCF) or OffsetCF;
			end

			local TargetC0: CFrame = (BaseC0 * ResolvedDelta);
			TS:Create(MotorInstance, Info, {
				C0 = TargetC0,
			}):Play();
		end
	end

	if IsR15 then
		local RightElbowMotor: Motor6D? = FindCharacterMotor(Character, 'RightElbow');
		local RightElbowBase: CFrame? = RestMap['RightElbow'];

		if RightElbowMotor and RightElbowBase then
			local RightBendDeg: number = (Keyframe.RightElbow) or 0.0;
			TS:Create(RightElbowMotor, Info, {
				C0 = (RightElbowBase * CFrame.Angles(math.rad(RightBendDeg), 0.0, 0.0)),
			}):Play();
		end

		local LeftElbowMotor: Motor6D? = FindCharacterMotor(Character, 'LeftElbow');
		local LeftElbowBase: CFrame? = RestMap['LeftElbow'];

		if LeftElbowMotor and LeftElbowBase then
			local LeftBendDeg: number = (Keyframe.LeftElbow) or 0.0;
			TS:Create(LeftElbowMotor, Info, {
				C0 = (LeftElbowBase * CFrame.Angles(math.rad(LeftBendDeg), 0.0, 0.0)),
			}):Play();
		end
	end

	return;
end

local function ResetProceduralPose(Character: Model, FadeTime: number): ()
	ActiveProceduralCharacters[Character] = nil;

	local RestMap: MotorRestMap = EnsureRestC0Map(Character);
	local Info: TweenInfo = TweenInfo.new(math.max(0.05, FadeTime), (Enum.EasingStyle.Quad), (Enum.EasingDirection.Out));

	for SlotName: string?, BaseC0: CFrame in RestMap do
		if SlotName then
			local MotorInstance: Motor6D? = FindCharacterMotor(Character, SlotName);

			if MotorInstance then
				TS:Create(MotorInstance, Info, {
					C0 = BaseC0,
				}):Play();
			end
		end
	end

	return;
end

---> Plays a multi-phase procedural `Motor6D` limb animation (`Windup` -> `Strike` -> `FollowThrough` -> `Rest`) on both R6 and R15 rigs while keeping `HumanoidRootPart` upright.
local function PlayProceduralPose(Character: Model, PoseKey: string, Speed: number?): ()
	if not Character or not (Character.Parent) then return end

	local PoseEntry: PoseDefinition? = PoseLibrary[PoseKey];

	if not PoseEntry then return end

	local SafeEntry: PoseDefinition = (PoseEntry :: PoseDefinition);
	local ResolvedSpeed: number = math.max(0.25, (Speed or 1.0));
	local TotalDuration: number = ((SafeEntry.Duration) / ResolvedSpeed);
	local NextToken: number = ((ProceduralTokens[Character] or 0) + 1);
	ProceduralTokens[Character] = NextToken;
	ActiveProceduralCharacters[Character] = true;

	if (SafeEntry.Windup) then
		local WindupTime: number = (TotalDuration * 0.24);
		local StrikeTime: number = (SafeEntry.FollowThrough) and (TotalDuration * 0.42) or (TotalDuration * 0.76);
		local FollowTime: number = (TotalDuration * 0.34);

		ApplyPoseKeyframe(Character, (SafeEntry.Windup :: PoseKeyframe), WindupTime, (Enum.EasingStyle.Quad));

		task.delay(WindupTime, function(): ()
			if (ProceduralTokens[Character] ~= NextToken) or not (Character.Parent) then return end

			ApplyPoseKeyframe(Character, (SafeEntry.Strike), StrikeTime, (SafeEntry.StrikeEasing));

			if not (SafeEntry.HoldPose) then
				task.delay(StrikeTime, function(): ()
					if (ProceduralTokens[Character] ~= NextToken) or not (Character.Parent) then return end

					if (SafeEntry.FollowThrough) then
						ApplyPoseKeyframe(Character, (SafeEntry.FollowThrough :: PoseKeyframe), FollowTime, (Enum.EasingStyle.Sine));

						task.delay(FollowTime, function(): ()
							if (ProceduralTokens[Character] ~= NextToken) or not (Character.Parent) then return end

							ResetProceduralPose(Character, 0.12);

							return;
						end);
					else
						ResetProceduralPose(Character, 0.14);
					end

					return;
				end);
			end

			return;
		end);
	else
		ApplyPoseKeyframe(Character, (SafeEntry.Strike), TotalDuration, (SafeEntry.StrikeEasing));

		if not (SafeEntry.HoldPose) then
			task.delay(TotalDuration, function(): ()
				if (ProceduralTokens[Character] ~= NextToken) or not (Character.Parent) then return end

				ResetProceduralPose(Character, 0.14);

				return;
			end);
		end
	end

	return;
end

local function InferPoseKeyFromAnimation(Character: Model, AnimationID: string, PoseOverride: string?): (string)
	local EquippedStyle: string = ((Character:GetAttribute('EquippedWeapon') :: string?) or 'Fists');

	if PoseOverride then
		if (EquippedStyle == 'Fists') then
			if (PoseOverride == 'Combo1') then return 'FistCombo1' end
			if (PoseOverride == 'Combo2') then return 'FistCombo2' end
			if (PoseOverride == 'Combo3') then return 'FistCombo3' end
			if (PoseOverride == 'Combo4') then return 'FistCombo4' end
			if (PoseOverride == 'Heavy') then return 'FistHeavy' end
		end

		if (PoseLibrary[PoseOverride] ~= nil) then
			return PoseOverride;
		end
	end

	if (string.sub(AnimationID, 1, 13) == 'procedural://') then
		local CustomKey: string = string.sub(AnimationID, 14);

		if (PoseLibrary[CustomKey] ~= nil) then
			return CustomKey;
		end
	end

	if (AnimationID == 'rbxassetid://507770818') then
		return 'Block';
	elseif (AnimationID == 'rbxassetid://507765000') then
		return 'Dash';
	elseif (AnimationID == 'rbxassetid://507770239') then
		return 'RageAwaken';
	elseif (AnimationID == 'rbxassetid://507766388') then
		return 'Glider';
	elseif (AnimationID == 'rbxassetid://522638767') then
		local ComboStep: number = ((Character:GetAttribute('Combo') :: number?) or 1);

		if (EquippedStyle == 'Fists') then
			return (ComboStep == 4) and 'FistCombo4' or 'FistHeavy';
		end

		return (ComboStep == 4) and 'Combo4' or 'Heavy';
	end

	local CurrentCombo: number = math.clamp(((Character:GetAttribute('Combo') :: number?) or 1), 1, 4);

	if (EquippedStyle == 'Fists') then
		return `FistCombo{CurrentCombo}`;
	end

	return `Combo{CurrentCombo}`;
end

---> Loads, caches, and plays an <AnimationTrack> or custom procedural keyframe sequence on <Character>.
local function PlayAnimation(Character: Model, AnimationID: string, Priority: Enum.AnimationPriority?, Speed: number?, PoseOverride: string?): (AnimationTrack?)
	if not Character then return nil end

	local Humanoid: Humanoid? = Character:FindFirstChildOfClass('Humanoid');

	if not Humanoid then return nil end

	local ResolvedSpeed: number = Speed or 1.0;
	local InferredPose: string = InferPoseKeyFromAnimation(Character, AnimationID, PoseOverride);
	local IsProceduralID: boolean = (AnimationID == '') or (AnimationID == 'rbxassetid://0') or (string.sub(AnimationID, 1, 13) == 'procedural://');
	local IsFistsStyle: boolean = (((Character:GetAttribute('EquippedWeapon') :: string?) or 'Fists') == 'Fists');

	if IsProceduralID or IsFistsStyle then
		PlayProceduralPose(Character, InferredPose, ResolvedSpeed);

		return nil;
	end

	local IsR6Rig: boolean = ((Humanoid.RigType) == (Enum.HumanoidRigType.R6)) or (Character:FindFirstChild('Torso') ~= nil);
	local TargetAnimator: Animator = GetOrCreateAnimator(Humanoid);
	local CharacterTracks: TrackDictionary? = LoadedTracks[Character];

	if not CharacterTracks then
		local NewTrackMap: TrackDictionary = { };
		LoadedTracks[Character] = NewTrackMap;
		CharacterTracks = NewTrackMap;
	end

	local SafeTrackMap: TrackDictionary = (CharacterTracks :: TrackDictionary);
	local CachedTrack: AnimationTrack? = SafeTrackMap[AnimationID];

	if not CachedTrack then
		local AnimationObject: Animation = Instance.new('Animation');
		AnimationObject.AnimationId = AnimationID;

		local LoadSuccess: boolean, LoadedResult: AnimationTrack = pcall(function(): (AnimationTrack)
			return TargetAnimator:LoadAnimation(AnimationObject);
		end);

		AnimationObject:Destroy();

		if not LoadSuccess or not LoadedResult then
			PlayProceduralPose(Character, InferredPose, ResolvedSpeed);

			return nil;
		end

		SafeTrackMap[AnimationID] = LoadedResult;
		CachedTrack = LoadedResult;
	end

	local ActiveTrack: AnimationTrack = (CachedTrack :: AnimationTrack);
	local ResolvedPriority: Enum.AnimationPriority = Priority or (Enum.AnimationPriority.Action);

	ActiveTrack.Priority = ResolvedPriority;
	ActiveTrack:Play(0.08);
	ActiveTrack:AdjustSpeed(ResolvedSpeed);

	if IsR6Rig or ((ActiveTrack.Length) == 0) then
		PlayProceduralPose(Character, InferredPose, ResolvedSpeed);
	end

	return ActiveTrack;
end

---> Smoothly stops a specific cached <AnimationTrack> on the target <Character> and restores `Motor6D` rest poses.
local function StopProceduralPose(Character: Model, FadeTime: number?): ()
	if not Character then return end

	local ResolvedFade: number = FadeTime or 0.12;
	ProceduralTokens[Character] = ((ProceduralTokens[Character] or 0) + 1);
	ResetProceduralPose(Character, ResolvedFade);

	return;
end

local function StopAnimation(Character: Model, AnimationID: string, FadeTime: number?): ()
	local ResolvedFade: number = FadeTime or 0.12;
	local CharacterTracks: TrackDictionary? = LoadedTracks[Character];

	if CharacterTracks then
		local TargetTrack: AnimationTrack? = CharacterTracks[AnimationID];

		if TargetTrack and (TargetTrack.IsPlaying) then
			TargetTrack:Stop(ResolvedFade);
		end
	end

	ProceduralTokens[Character] = ((ProceduralTokens[Character] or 0) + 1);
	ResetProceduralPose(Character, ResolvedFade);

	return;
end

---> Stops all cached combat animations on the target <Character>.
local function StopAllCombat(Character: Model): ()
	local CharacterTracks: TrackDictionary? = LoadedTracks[Character];

	if CharacterTracks then
		for _: string?, TrackInstance: AnimationTrack in CharacterTracks do
			if (TrackInstance.IsPlaying) then
				TrackInstance:Stop(0.1);
			end
		end
	end

	ProceduralTokens[Character] = ((ProceduralTokens[Character] or 0) + 1);
	ResetProceduralPose(Character, 0.1);

	return;
end

---> Freezes playing <AnimationTrack> speeds (`AdjustSpeed(0.0)`) on <Character> to create visceral hitstop impact.
local function ApplyHitstop(Character: Model, Duration: number): ()
	if (Duration <= 0) then return end

	local CharacterTracks: TrackDictionary? = LoadedTracks[Character];

	if not CharacterTracks then return end

	local NextToken: number = ((HitstopTokens[Character] or 0) + 1);
	HitstopTokens[Character] = NextToken;

	for _: string?, TrackInstance: AnimationTrack in CharacterTracks do
		if (TrackInstance.IsPlaying) then
			TrackInstance:AdjustSpeed(0.0);
		end
	end

	task.delay(Duration, function(): ()
		if (HitstopTokens[Character] ~= NextToken) then return end

		local CurrentTracks: TrackDictionary? = LoadedTracks[Character];

		if not CurrentTracks then return end

		local RestoreSpeed: number = ((Character:GetAttribute('IsRageActive')) == true) and 1.18 or 1.0;

		for _: string?, TrackInstance: AnimationTrack in CurrentTracks do
			if (TrackInstance.IsPlaying) then
				TrackInstance:AdjustSpeed(RestoreSpeed);
			end
		end

		return;
	end);

	return;
end

---> Releases cached animation references when a <Character> despawns.
local function CleanupCache(Character: Model): ()
	LoadedTracks[Character] = nil;
	HitstopTokens[Character] = nil;
	ProceduralTokens[Character] = nil;
	ActiveProceduralCharacters[Character] = nil;
	CachedRestC0Map[Character] = nil;

	return;
end



---> Neutralizes `Animator`'s default `Idle` / `Walk` `Transform` on upper-body joints while a procedural combat pose is active so punches are never diluted.
RS.Stepped:Connect(function(_: number, _: number): ()
	local UpperBodySlots: { [number?]: string } = {
		[1] = 'RootJoint',
		[2] = 'Neck',
		[3] = 'Right Shoulder',
		[4] = 'Left Shoulder',
		[5] = 'RightElbow',
		[6] = 'LeftElbow',
	};

	for ActiveChar: Model?, IsActive: boolean in ActiveProceduralCharacters do
		if ActiveChar and IsActive and (ActiveChar.Parent) then
			for _: number?, SlotName: string in UpperBodySlots do
				local MotorObj: Motor6D? = FindCharacterMotor(ActiveChar, SlotName);

				if MotorObj then
					MotorObj.Transform = CFrame.identity;
				end
			end
		elseif ActiveChar then
			ActiveProceduralCharacters[ActiveChar] = nil;
		end
	end

	return;
end);

local AnimationHandler: AnimationHandlerModule = {
	PlayAnimation      = PlayAnimation,
	PlayProceduralPose = PlayProceduralPose,
	StopProceduralPose = StopProceduralPose,
	StopAnimation      = StopAnimation,
	StopAllCombat      = StopAllCombat,
	ApplyHitstop       = ApplyHitstop,
	CleanupCache       = CleanupCache,
};



return AnimationHandler;
