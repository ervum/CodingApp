--!strict

local ReplicatedStorage: ReplicatedStorage = game:GetService('ReplicatedStorage');
local WS: Workspace = game:GetService('Workspace');

local ModulesFolder: Instance = ReplicatedStorage:WaitForChild('Modules');

local AnimationHandler = require(ModulesFolder:WaitForChild('AnimationHandler') :: ModuleScript);
local AnimationRegistry = require(ModulesFolder:WaitForChild('AnimationRegistry') :: ModuleScript);
local CombatTable = require(ModulesFolder:WaitForChild('CombatTable') :: ModuleScript);
local MovementVFX = require(ModulesFolder:WaitForChild('MovementVFX') :: ModuleScript);
local PhysicsImpulse = require(ModulesFolder:WaitForChild('PhysicsImpulse') :: ModuleScript);
local StaminaHandler = require(ModulesFolder:WaitForChild('StaminaHandler') :: ModuleScript);
local StateHandler = require(ModulesFolder:WaitForChild('StateHandler') :: ModuleScript);
local WeaponHandler = require(ModulesFolder:WaitForChild('WeaponHandler') :: ModuleScript);



export type ActiveMoverHandle = PhysicsImpulse.ActiveMoverHandle;

export type GliderHandlerModule = {
	EquipGlider:     ((Model) -> (boolean)),
	UnequipGlider:   ((Model) -> ()),
	UpdateCharacter: ((Model, number) -> ()),
};



local ActiveGliderMovers: { [Model?]: ActiveMoverHandle } = { };



local function AttachGliderModel(Character: Model): ()
	local ExistingModel: Instance? = Character:FindFirstChild('ActiveGliderVisual');

	if ExistingModel then
		ExistingModel:Destroy();
	end

	local WeaponsFolder: Folder = WeaponHandler.EnsureWeaponAssets();
	local GliderTemplate: Instance? = WeaponsFolder:FindFirstChild('Glider');

	if not GliderTemplate or not GliderTemplate:IsA('Model') then return end

	local TorsoLimb: BasePart? = (Character:FindFirstChild('UpperTorso') :: BasePart?) or (Character:FindFirstChild('Torso') :: BasePart?) or (Character:FindFirstChild('HumanoidRootPart') :: BasePart?);

	if not TorsoLimb then return end

	local ClonedGlider: Model = GliderTemplate:Clone();
	ClonedGlider.Name = 'ActiveGliderVisual';

	local PrimaryWing: BasePart? = (ClonedGlider.PrimaryPart) or ClonedGlider:FindFirstChildWhichIsA('BasePart');

	if not PrimaryWing then
		ClonedGlider:Destroy();

		return;
	end

	local SafeWing: BasePart = (PrimaryWing :: BasePart);
	local WingOriginCFrame: CFrame = (SafeWing.CFrame);
	local RelativeCFrameMap: { [BasePart?]: CFrame } = { };

	for _: number, DescendantPart: Instance in ClonedGlider:GetDescendants() do
		if DescendantPart:IsA('BasePart') then
			DescendantPart.Anchored = false;
			DescendantPart.CanCollide = false;
			DescendantPart.CanQuery = false;
			DescendantPart.CanTouch = false;
			DescendantPart.Massless = true;

			if (DescendantPart ~= SafeWing) then
				RelativeCFrameMap[DescendantPart] = WingOriginCFrame:ToObjectSpace((DescendantPart.CFrame));
			end
		end
	end

	local TargetWingCFrame: CFrame = ((TorsoLimb.CFrame) * CFrame.new(0.0, 2.8, 0.4));
	SafeWing.CFrame = TargetWingCFrame;

	for ChildPart: BasePart?, RelativeOffset: CFrame in RelativeCFrameMap do
		if ChildPart then
			ChildPart.CFrame = (TargetWingCFrame * RelativeOffset);

			local PartWeld: WeldConstraint = Instance.new('WeldConstraint');
			PartWeld.Part0 = SafeWing;
			PartWeld.Part1 = ChildPart;
			PartWeld.Parent = SafeWing;
		end
	end

	ClonedGlider.Parent = Character;

	local RootWeld: WeldConstraint = Instance.new('WeldConstraint');
	RootWeld.Name = 'GliderRootWeld';
	RootWeld.Part0 = TorsoLimb;
	RootWeld.Part1 = SafeWing;
	RootWeld.Parent = SafeWing;

	return;
end

---> Disengages the Glider on <Character> and cleans up movers, trails, and 3D wing models.
local function UnequipGlider(Character: Model): ()
	if not Character then return end
	if not StateHandler.GetBoolean(Character, 'IsGliding') then return end

	StateHandler.SetState(Character, 'IsGliding', false);

	local ExistingMover: ActiveMoverHandle? = ActiveGliderMovers[Character];

	if ExistingMover then
		ExistingMover.Destroy();
		ActiveGliderMovers[Character] = nil;
	end

	local ExistingVisual: Instance? = Character:FindFirstChild('ActiveGliderVisual');

	if ExistingVisual then
		ExistingVisual:Destroy();
	end

	AnimationHandler.StopAnimation(Character, (AnimationRegistry.Glider), 0.15);
	MovementVFX.ManageGliderTrail(Character, false);

	return;
end

---> Deploys the Glider in mid-air if <Character> has sufficient altitude and Stamina.
local function EquipGlider(Character: Model): (boolean)
	if not Character then return false end
	if StateHandler.GetBoolean(Character, 'IsGliding') then return true end
	if StateHandler.GetBoolean(Character, 'IsClimbing') or StateHandler.GetBoolean(Character, 'IsWallRunning') then return false end
	if not StateHandler.CanMoveFreely(Character) then return false end

	local CurrentStamina: number = StateHandler.GetNumber(Character, 'Stamina', 0.0);

	if (CurrentStamina < 6.0) then return false end

	local RootPart: BasePart? = (Character:FindFirstChild('HumanoidRootPart') :: BasePart?);

	if not RootPart then return false end

	local RayParams: RaycastParams = RaycastParams.new();
	RayParams.FilterType = (Enum.RaycastFilterType.Exclude);
	RayParams.FilterDescendantsInstances = { Character };

	local GroundHit: RaycastResult? = WS:Raycast((RootPart.Position), Vector3.new(0.0, -5.5, 0.0), RayParams);

	if GroundHit then return false end

	StateHandler.SetState(Character, 'IsGliding', true);

	local LookDirection: Vector3 = ((RootPart.CFrame.LookVector).Unit);
	local InitialGlideVelocity: Vector3 = Vector3.new(((LookDirection.X) * (CombatTable.GliderForwardSpeed)), (CombatTable.GliderFallSpeed), ((LookDirection.Z) * (CombatTable.GliderForwardSpeed)));

	local MoverHandle: ActiveMoverHandle = PhysicsImpulse.CreatePersistentMover(RootPart, 'GliderVelocityMover', InitialGlideVelocity, Vector3.new(55000, 55000, 55000));
	ActiveGliderMovers[Character] = MoverHandle;

	AttachGliderModel(Character);
	AnimationHandler.PlayAnimation(Character, (AnimationRegistry.Glider), (Enum.AnimationPriority.Movement), 1.0);
	MovementVFX.ManageGliderTrail(Character, true);

	return true;
end

---> Updates Glider forward propulsion, stamina drain, and automatic ground-landing disengagement.
local function UpdateCharacter(Character: Model, DeltaTime: number): ()
	if not StateHandler.GetBoolean(Character, 'IsGliding') then return end

	local RootPart: BasePart? = (Character:FindFirstChild('HumanoidRootPart') :: BasePart?);
	local Humanoid: Humanoid? = Character:FindFirstChildOfClass('Humanoid');

	if not RootPart or not Humanoid then
		UnequipGlider(Character);

		return;
	end

	local RayParams: RaycastParams = RaycastParams.new();
	RayParams.FilterType = (Enum.RaycastFilterType.Exclude);
	RayParams.FilterDescendantsInstances = { Character };

	local GroundHit: RaycastResult? = WS:Raycast((RootPart.Position), Vector3.new(0.0, -4.2, 0.0), RayParams);

	if GroundHit or ((Humanoid.FloorMaterial) ~= (Enum.Material.Air)) then
		UnequipGlider(Character);

		return;
	end

	local HasStamina: boolean = StaminaHandler.DrainContinuous(Character, (CombatTable.GliderStaminaDrain), DeltaTime);

	if not HasStamina then
		UnequipGlider(Character);

		return;
	end

	local ActiveMover: ActiveMoverHandle? = ActiveGliderMovers[Character];

	if ActiveMover then
		local ForwardDirection: Vector3 = ((RootPart.CFrame.LookVector).Unit);
		ActiveMover.VelocityMover.VectorVelocity = Vector3.new(((ForwardDirection.X) * (CombatTable.GliderForwardSpeed)), (CombatTable.GliderFallSpeed), ((ForwardDirection.Z) * (CombatTable.GliderForwardSpeed)));
	end

	return;
end



local GliderHandler: GliderHandlerModule = {
	EquipGlider     = EquipGlider,
	UnequipGlider   = UnequipGlider,
	UpdateCharacter = UpdateCharacter,
};



return GliderHandler;
