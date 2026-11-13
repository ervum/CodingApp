--!strict

local ReplicatedStorage: ReplicatedStorage = game:GetService('ReplicatedStorage');
local ModulesFolder: Instance = ReplicatedStorage:WaitForChild('Modules');

local CombatTable = require(ModulesFolder:WaitForChild('CombatTable') :: ModuleScript);
local PhysicsImpulse = require(ModulesFolder:WaitForChild('PhysicsImpulse') :: ModuleScript);
local StateHandler = require(ModulesFolder:WaitForChild('StateHandler') :: ModuleScript);



export type RagdollHandlerModule = {
	SetRagdoll:      ((Model, boolean, number?, Vector3?) -> ()),
	LaunchCharacter: ((Model, Vector3, number, number, number?) -> ()),
};



local ActiveRagdollTokens: { [Model?]: number } = { };
local ActiveLaunchTokens: { [Model?]: number } = { };



local function CleanupRagdollConstraints(Character: Model): ()
	for _: number, DescendantObject: Instance in Character:GetDescendants() do
		if DescendantObject:IsA('BallSocketConstraint') and (DescendantObject.Name == 'RagdollBallSocket') then
			DescendantObject:Destroy();
		elseif DescendantObject:IsA('Attachment') and ((DescendantObject.Name == 'RagdollAttachment0') or (DescendantObject.Name == 'RagdollAttachment1')) then
			DescendantObject:Destroy();
		elseif DescendantObject:IsA('Motor6D') then
			DescendantObject.Enabled = true;
		end
	end

	return;
end

---> Temporarily places <Character> into `PlatformStand = true` and `Physics` state (`0.55s`) while applying horizontal (`75-90`) and upward (`35-42`) launch impulse.
local function LaunchCharacter(Character: Model, HorizontalDirection: Vector3, HorizontalSpeed: number, VerticalSpeed: number, LaunchDuration: number?): ()
	if not Character then return end

	local Humanoid: Humanoid? = Character:FindFirstChildOfClass('Humanoid');
	local RootPart: BasePart? = (Character:FindFirstChild('HumanoidRootPart') :: BasePart?);

	if not Humanoid or not RootPart or ((Humanoid.Health) <= 0) then return end

	local PlanarDir: Vector3 = Vector3.new((HorizontalDirection.X), 0.0, (HorizontalDirection.Z));

	if ((PlanarDir.Magnitude) <= 0.01) then
		PlanarDir = Vector3.new(0.0, 0.0, -1.0);
	else
		PlanarDir = (PlanarDir.Unit);
	end

	local ClampedHorizontal: number = math.clamp(HorizontalSpeed, (CombatTable.FinisherMinHorizontalSpeed), (CombatTable.FinisherMaxHorizontalSpeed));
	local ClampedVertical: number = math.clamp(VerticalSpeed, 35.0, 42.0);
	local LaunchVelocity: Vector3 = ((PlanarDir * ClampedHorizontal) + Vector3.new(0.0, ClampedVertical, 0.0));
	local StateDuration: number = LaunchDuration or (CombatTable.FinisherLaunchStateDuration);

	local NextLaunchToken: number = ((ActiveLaunchTokens[Character] or 0) + 1);
	ActiveLaunchTokens[Character] = NextLaunchToken;

	RootPart.Anchored = false;
	Humanoid.PlatformStand = true;
	Humanoid.AutoRotate = false;
	Humanoid:ChangeState(Enum.HumanoidStateType.Physics);

	RootPart.CFrame = ((RootPart.CFrame) + Vector3.new(0.0, 0.65, 0.0));
	RootPart.AssemblyLinearVelocity = LaunchVelocity;
	PhysicsImpulse.ApplyImpulse(RootPart, LaunchVelocity, 0.26, Vector3.new(145000, 145000, 145000));

	task.delay(StateDuration, function(): ()
		if (ActiveLaunchTokens[Character] ~= NextLaunchToken) then return end
		if not (Character.Parent) or ((Humanoid.Health) <= 0) then return end

		if not StateHandler.GetBoolean(Character, 'IsRagdolled') then
			Humanoid.PlatformStand = false;
			Humanoid.AutoRotate = true;
			Humanoid:ChangeState(Enum.HumanoidStateType.GettingUp);
		end

		return;
	end);

	return;
end

---> Enables or disables physics ragdoll on <Character> using <BallSocketConstraint> joints and optional knockback <Velocity>.
local function SetRagdoll(Character: Model, EnableRagdoll: boolean, Duration: number?, KnockbackVelocity: Vector3?): ()
	if not Character then return end

	local Humanoid: Humanoid? = Character:FindFirstChildOfClass('Humanoid');
	local RootPart: BasePart? = (Character:FindFirstChild('HumanoidRootPart') :: BasePart?);

	if not Humanoid or not RootPart or ((Humanoid.Health) <= 0) then return end

	local NextToken: number = ((ActiveRagdollTokens[Character] or 0) + 1);
	ActiveRagdollTokens[Character] = NextToken;

	if EnableRagdoll then
		StateHandler.SetState(Character, 'IsRagdolled', true);
		StateHandler.SetState(Character, 'IsBlocking', false);
		StateHandler.SetState(Character, 'IsParrying', false);
		StateHandler.SetState(Character, 'IsAttacking', false);

		RootPart.Anchored = false;
		Humanoid.PlatformStand = true;
		Humanoid.AutoRotate = false;
		Humanoid:ChangeState(Enum.HumanoidStateType.Physics);

		for _: number, DescendantObject: Instance in Character:GetDescendants() do
			if DescendantObject:IsA('Motor6D') and (DescendantObject.Part0 ~= nil) and (DescendantObject.Part1 ~= nil) then
				if (DescendantObject.Name == 'RootJoint') or (DescendantObject.Name == 'Root') or (DescendantObject.Name == 'TorsoJoint') or (DescendantObject.Name == 'WeaponGripMotor') or (DescendantObject.Name == 'RightGripMotor') then
					continue;
				end

				local Attachment0: Attachment = Instance.new('Attachment');
				Attachment0.Name = 'RagdollAttachment0';
				Attachment0.CFrame = (DescendantObject.C0);
				Attachment0.Parent = (DescendantObject.Part0);

				local Attachment1: Attachment = Instance.new('Attachment');
				Attachment1.Name = 'RagdollAttachment1';
				Attachment1.CFrame = (DescendantObject.C1);
				Attachment1.Parent = (DescendantObject.Part1);

				local SocketConstraint: BallSocketConstraint = Instance.new('BallSocketConstraint');
				SocketConstraint.Name = 'RagdollBallSocket';
				SocketConstraint.Attachment0 = Attachment0;
				SocketConstraint.Attachment1 = Attachment1;
				SocketConstraint.LimitsEnabled = true;
				SocketConstraint.TwistLimitsEnabled = true;
				SocketConstraint.UpperAngle = 45.0;
				SocketConstraint.TwistLowerAngle = -35.0;
				SocketConstraint.TwistUpperAngle = 35.0;
				SocketConstraint.Parent = (DescendantObject.Part0);

				DescendantObject.Enabled = false;
			end
		end

		if KnockbackVelocity then
			RootPart.CFrame = ((RootPart.CFrame) + Vector3.new(0.0, 0.65, 0.0));
			RootPart.AssemblyLinearVelocity = KnockbackVelocity;
			PhysicsImpulse.ApplyImpulse(RootPart, KnockbackVelocity, 0.26, Vector3.new(145000, 145000, 145000));
		end

		if Duration and (Duration > 0) then
			task.delay(Duration, function(): ()
				if (ActiveRagdollTokens[Character] ~= NextToken) then return end

				SetRagdoll(Character, false, nil, nil);

				return;
			end);
		end
	else
		CleanupRagdollConstraints(Character);

		StateHandler.SetState(Character, 'IsRagdolled', false);

		Humanoid.PlatformStand = false;
		Humanoid.AutoRotate = true;
		Humanoid:ChangeState(Enum.HumanoidStateType.GettingUp);

		if not StateHandler.GetBoolean(Character, 'IsStunned') then
			local IsRageActive: boolean = StateHandler.GetBoolean(Character, 'IsRageActive');
			local RestoredSpeed: number = IsRageActive and (CombatTable.RageWalkSpeed) or (CombatTable.DefaultWalkSpeed);
			local IsPassiveDummy: boolean = (Character:GetAttribute('IsPassiveDummy') == true);

			Humanoid.WalkSpeed = IsPassiveDummy and 0.0 or RestoredSpeed;
			Humanoid.JumpPower = (CombatTable.DefaultJumpPower);
		end
	end

	return;
end



local RagdollHandler: RagdollHandlerModule = {
	SetRagdoll      = SetRagdoll,
	LaunchCharacter = LaunchCharacter,
};



return RagdollHandler;
