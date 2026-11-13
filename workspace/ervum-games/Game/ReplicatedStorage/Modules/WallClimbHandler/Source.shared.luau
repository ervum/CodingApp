--!strict

local ReplicatedStorage: ReplicatedStorage = game:GetService('ReplicatedStorage');
local WS: Workspace = game:GetService('Workspace');

local ModulesFolder: Instance = ReplicatedStorage:WaitForChild('Modules');

local AnimationHandler = require(ModulesFolder:WaitForChild('AnimationHandler') :: ModuleScript);
local AnimationRegistry = require(ModulesFolder:WaitForChild('AnimationRegistry') :: ModuleScript);
local CombatTable = require(ModulesFolder:WaitForChild('CombatTable') :: ModuleScript);
local DamageIndicator = require(ModulesFolder:WaitForChild('DamageIndicator') :: ModuleScript);
local MovementVFX = require(ModulesFolder:WaitForChild('MovementVFX') :: ModuleScript);
local PhysicsImpulse = require(ModulesFolder:WaitForChild('PhysicsImpulse') :: ModuleScript);
local StaminaHandler = require(ModulesFolder:WaitForChild('StaminaHandler') :: ModuleScript);
local StateHandler = require(ModulesFolder:WaitForChild('StateHandler') :: ModuleScript);



export type ActiveMoverHandle = PhysicsImpulse.ActiveMoverHandle;

export type WallRunSession = {
	MoverHandle: ActiveMoverHandle,
	WallSide:    string,
	StartClock:  number,
};

export type WallClimbHandlerModule = {
	StartClimb:       ((Model) -> (boolean)),
	StopClimb:        ((Model, boolean?) -> ()),
	StartWallRun:     ((Model) -> (boolean)),
	StopWallRun:      ((Model, boolean?) -> ()),
	UpdateCharacter:  ((Model, number) -> ()),
	ApplyFallDamage:  ((Model, number) -> ()),
};



local ActiveClimbMovers: { [Model?]: ActiveMoverHandle } = { };
local ActiveWallRuns: { [Model?]: WallRunSession } = { };
local DustCooldownMap: { [Model?]: number } = { };



local function BuildWallRaycastParams(Character: Model): (RaycastParams)
	local Params: RaycastParams = RaycastParams.new();
	Params.FilterType = (Enum.RaycastFilterType.Exclude);

	local LiveFolder: Instance? = WS:FindFirstChild('Live');

	if LiveFolder then
		Params.FilterDescendantsInstances = { Character, LiveFolder };
	else
		Params.FilterDescendantsInstances = { Character };
	end

	return Params;
end

local function DetectFrontalWall(Character: Model): (RaycastResult?)
	local RootPart: BasePart? = (Character:FindFirstChild('HumanoidRootPart') :: BasePart?);

	if not RootPart then return nil end

	local ForwardRayVector: Vector3 = (((RootPart.CFrame.LookVector).Unit) * (CombatTable.WallDetectionDistance));
	local Params: RaycastParams = BuildWallRaycastParams(Character);
	local Result: RaycastResult? = WS:Raycast((RootPart.Position), ForwardRayVector, Params);

	return Result;
end

local function DetectSideWall(Character: Model): (RaycastResult?, string)
	local RootPart: BasePart? = (Character:FindFirstChild('HumanoidRootPart') :: BasePart?);

	if not RootPart then return nil, 'None' end

	local RightVector: Vector3 = ((RootPart.CFrame.RightVector).Unit);
	local RayDist: number = (CombatTable.WallRunSideRayDistance);
	local Params: RaycastParams = BuildWallRaycastParams(Character);

	local RightResult: RaycastResult? = WS:Raycast((RootPart.Position), (RightVector * RayDist), Params);

	if RightResult then
		return RightResult, 'Right';
	end

	local LeftResult: RaycastResult? = WS:Raycast((RootPart.Position), ((-RightVector) * RayDist), Params);

	if LeftResult then
		return LeftResult, 'Left';
	end

	return nil, 'None';
end

---> Stops vertical wall climbing on <Character> and optionally performs a ledge vault / wall-hop.
local function StopClimb(Character: Model, PerformWallHop: boolean?): ()
	if not Character then return end
	if not StateHandler.GetBoolean(Character, 'IsClimbing') then return end

	StateHandler.SetState(Character, 'IsClimbing', false);

	local ExistingMover: ActiveMoverHandle? = ActiveClimbMovers[Character];

	if ExistingMover then
		ExistingMover.Destroy();
		ActiveClimbMovers[Character] = nil;
	end

	AnimationHandler.StopAnimation(Character, (AnimationRegistry.WallClimb), 0.12);

	local Humanoid: Humanoid? = Character:FindFirstChildOfClass('Humanoid');
	local RootPart: BasePart? = (Character:FindFirstChild('HumanoidRootPart') :: BasePart?);

	if Humanoid then
		Humanoid.AutoRotate = true;
	end

	if (PerformWallHop == true) and RootPart then
		local HopVelocity: Vector3 = (Vector3.new(0.0, (CombatTable.WallHopUpForce), 0.0) - (((RootPart.CFrame.LookVector).Unit) * ((CombatTable.WallHopBackForce) * 0.45)));
		PhysicsImpulse.ApplyImpulse(RootPart, HopVelocity, 0.18);
	end

	return;
end

---> Initiates vertical wall climbing if <Character> faces a valid climbable surface.
local function StartClimb(Character: Model): (boolean)
	if not Character then return false end
	if StateHandler.GetBoolean(Character, 'IsClimbing') then return true end
	if not StateHandler.CanMoveFreely(Character) then return false end

	local CurrentStamina: number = StateHandler.GetNumber(Character, 'Stamina', 0.0);

	if (CurrentStamina < 10.0) then return false end

	local WallRayResult: RaycastResult? = DetectFrontalWall(Character);

	if not WallRayResult then return false end

	local RootPart: BasePart? = (Character:FindFirstChild('HumanoidRootPart') :: BasePart?);
	local Humanoid: Humanoid? = Character:FindFirstChildOfClass('Humanoid');

	if not RootPart or not Humanoid then return false end

	StateHandler.SetState(Character, 'IsClimbing', true);
	StateHandler.SetState(Character, 'IsGliding', false);
	StateHandler.SetState(Character, 'IsWallRunning', false);

	Humanoid.AutoRotate = false;

	local ClimbVelocity: Vector3 = Vector3.new(0.0, (CombatTable.WallClimbSpeed), 0.0);
	local MoverHandle: ActiveMoverHandle = PhysicsImpulse.CreatePersistentMover(RootPart, 'WallClimbMover', ClimbVelocity, Vector3.new(75000, 75000, 75000));
	ActiveClimbMovers[Character] = MoverHandle;

	AnimationHandler.PlayAnimation(Character, (AnimationRegistry.WallClimb), (Enum.AnimationPriority.Movement), 1.15);

	return true;
end

---> Stops horizontal wall-running on <Character> and optionally launches a lateral wall-jump.
local function StopWallRun(Character: Model, PerformWallJump: boolean?): ()
	if not Character then return end
	if not StateHandler.GetBoolean(Character, 'IsWallRunning') then return end

	StateHandler.SetState(Character, 'IsWallRunning', false);

	local ActiveSession: WallRunSession? = ActiveWallRuns[Character];

	if ActiveSession then
		ActiveSession.MoverHandle.Destroy();
		ActiveWallRuns[Character] = nil;
	end

	AnimationHandler.StopAnimation(Character, (AnimationRegistry.WallRunLeft), 0.12);
	AnimationHandler.StopAnimation(Character, (AnimationRegistry.WallRunRight), 0.12);

	local RootPart: BasePart? = (Character:FindFirstChild('HumanoidRootPart') :: BasePart?);

	if (PerformWallJump == true) and RootPart then
		local WallResult: RaycastResult?, _: string = DetectSideWall(Character);
		local PushAwayVector: Vector3 = WallResult and (WallResult.Normal) or (-(RootPart.CFrame.RightVector));
		local ForwardBoost: Vector3 = (((RootPart.CFrame.LookVector).Unit) * 28.0);
		local JumpImpulse: Vector3 = ((PushAwayVector * 32.0) + ForwardBoost + Vector3.new(0.0, 42.0, 0.0));

		PhysicsImpulse.ApplyImpulse(RootPart, JumpImpulse, 0.2);
	end

	return;
end

---> Initiates horizontal wall-running (`Assets/Skater/Wall Run` style) when airborne alongside a lateral wall.
local function StartWallRun(Character: Model): (boolean)
	if not Character then return false end
	if StateHandler.GetBoolean(Character, 'IsWallRunning') then return true end
	if StateHandler.GetBoolean(Character, 'IsClimbing') then return false end
	if not StateHandler.CanMoveFreely(Character) then return false end

	local CurrentStamina: number = StateHandler.GetNumber(Character, 'Stamina', 0.0);

	if (CurrentStamina < 10.0) then return false end

	local SideHit: RaycastResult?, WallSide: string = DetectSideWall(Character);

	if not SideHit then return false end

	local RootPart: BasePart? = (Character:FindFirstChild('HumanoidRootPart') :: BasePart?);

	if not RootPart then return false end

	StateHandler.SetState(Character, 'IsWallRunning', true);
	StateHandler.SetState(Character, 'IsGliding', false);

	local WallNormal: Vector3 = (SideHit.Normal);
	local ForwardVector: Vector3 = (RootPart.CFrame.LookVector);
	local WallTangent: Vector3 = (ForwardVector - (WallNormal * ForwardVector:Dot(WallNormal)));

	if ((WallTangent.Magnitude) <= 0.05) then
		WallTangent = (ForwardVector.Unit);
	else
		WallTangent = (WallTangent.Unit);
	end

	local RunVelocity: Vector3 = ((WallTangent * (CombatTable.WallRunSpeed)) + Vector3.new(0.0, (CombatTable.WallRunGravityVelocity), 0.0));
	local MoverHandle: ActiveMoverHandle = PhysicsImpulse.CreatePersistentMover(RootPart, 'WallRunMover', RunVelocity, Vector3.new(75000, 75000, 75000));

	ActiveWallRuns[Character] = {
		MoverHandle = MoverHandle,
		WallSide    = WallSide,
		StartClock  = os.clock(),
	};

	local AnimID: string = (WallSide == 'Left') and (AnimationRegistry.WallRunLeft) or (AnimationRegistry.WallRunRight);
	AnimationHandler.PlayAnimation(Character, AnimID, (Enum.AnimationPriority.Movement), 1.2);

	return true;
end

---> Updates active Wall-Climb and Wall-Run physics, stamina drain, and dust VFX for <Character>.
local function UpdateCharacter(Character: Model, DeltaTime: number): ()
	local RootPart: BasePart? = (Character:FindFirstChild('HumanoidRootPart') :: BasePart?);

	if not RootPart then return end

	if StateHandler.GetBoolean(Character, 'IsClimbing') then
		local WallHit: RaycastResult? = DetectFrontalWall(Character);

		if not WallHit then
			StopClimb(Character, true);

			return;
		end

		local HasStamina: boolean = StaminaHandler.DrainContinuous(Character, (CombatTable.WallClimbStaminaDrain), DeltaTime);

		if not HasStamina then
			StopClimb(Character, false);

			return;
		end

		local HitPosition: Vector3 = (WallHit.Position);
		local HitNormal: Vector3 = (WallHit.Normal);
		local TargetPosition: Vector3 = (HitPosition + (HitNormal * 1.9));
		local LookAtTarget: Vector3 = (TargetPosition - HitNormal);

		RootPart.CFrame = CFrame.lookAt((RootPart.Position), Vector3.new((LookAtTarget.X), (RootPart.Position.Y), (LookAtTarget.Z)));

		local NowClock: number = os.clock();

		if ((NowClock - (DustCooldownMap[Character] or 0.0)) >= 0.22) then
			DustCooldownMap[Character] = NowClock;
			MovementVFX.SpawnWallDust(HitPosition, HitNormal);
		end
	elseif StateHandler.GetBoolean(Character, 'IsWallRunning') then
		local Session: WallRunSession? = ActiveWallRuns[Character];

		if not Session then
			StopWallRun(Character, false);

			return;
		end

		local SafeSession: WallRunSession = (Session :: WallRunSession);

		if ((os.clock() - (SafeSession.StartClock)) >= (CombatTable.WallRunMaxDuration)) then
			StopWallRun(Character, true);

			return;
		end

		local SideHit: RaycastResult?, _: string = DetectSideWall(Character);

		if not SideHit then
			StopWallRun(Character, true);

			return;
		end

		local HasStamina: boolean = StaminaHandler.DrainContinuous(Character, (CombatTable.WallRunStaminaDrain), DeltaTime);

		if not HasStamina then
			StopWallRun(Character, false);

			return;
		end

		local WallNormal: Vector3 = (SideHit.Normal);
		local ForwardLook: Vector3 = (RootPart.CFrame.LookVector);
		local TangentVector: Vector3 = (ForwardLook - (WallNormal * ForwardLook:Dot(WallNormal)));

		if ((TangentVector.Magnitude) > 0.05) then
			local UnitTangent: Vector3 = (TangentVector.Unit);
			SafeSession.MoverHandle.VelocityMover.VectorVelocity = ((UnitTangent * (CombatTable.WallRunSpeed)) + Vector3.new(0.0, (CombatTable.WallRunGravityVelocity), 0.0));
		end

		local NowClock: number = os.clock();

		if ((NowClock - (DustCooldownMap[Character] or 0.0)) >= 0.18) then
			DustCooldownMap[Character] = NowClock;
			MovementVFX.SpawnWallDust((SideHit.Position), WallNormal);
		end
	end

	return;
end

---> Applies velocity-scaled Fall Damage (`Assets/Skater/Fall Damage` formula) when landing at high downward speed.
local function ApplyFallDamage(Character: Model, DownwardSpeedMagnitude: number): ()
	if not Character then return end
	if (DownwardSpeedMagnitude < (CombatTable.FallDamageThresholdVelocity)) then return end

	if StateHandler.GetBoolean(Character, 'IsGliding') or StateHandler.GetBoolean(Character, 'IsDodging') or StateHandler.GetBoolean(Character, 'IsAttacking') then
		return;
	end

	local Humanoid: Humanoid? = Character:FindFirstChildOfClass('Humanoid');

	if not Humanoid or ((Humanoid.Health) <= 0) then return end

	local ExcessSpeed: number = (DownwardSpeedMagnitude - (CombatTable.FallDamageThresholdVelocity));
	local ComputedDamage: number = math.clamp((ExcessSpeed * (CombatTable.FallDamageMultiplier)), 5.0, 95.0);

	Humanoid:TakeDamage(ComputedDamage);
	DamageIndicator.SpawnCallout(Character, `-{math.floor(ComputedDamage)} FALL`, Color3.fromRGB(255, 115, 55), 26.0);

	return;
end



local WallClimbHandler: WallClimbHandlerModule = {
	StartClimb      = StartClimb,
	StopClimb       = StopClimb,
	StartWallRun    = StartWallRun,
	StopWallRun     = StopWallRun,
	UpdateCharacter = UpdateCharacter,
	ApplyFallDamage = ApplyFallDamage,
};



return WallClimbHandler;
