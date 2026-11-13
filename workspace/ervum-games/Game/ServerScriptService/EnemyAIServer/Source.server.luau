--!strict

local Players: Players = game:GetService('Players');
local ReplicatedStorage: ReplicatedStorage = game:GetService('ReplicatedStorage');
local WS: Workspace = game:GetService('Workspace');

if not WS:FindFirstChild('Live') then
	local PrebootLiveFolder: Folder = Instance.new('Folder');
	PrebootLiveFolder.Name = 'Live';
	PrebootLiveFolder.Parent = WS;
end

local ModulesFolder: Instance = ReplicatedStorage:WaitForChild('Modules');

local AnimationHandler = require(ModulesFolder:WaitForChild('AnimationHandler') :: ModuleScript);
local AnimationRegistry = require(ModulesFolder:WaitForChild('AnimationRegistry') :: ModuleScript);
local CombatManager = require(ModulesFolder:WaitForChild('CombatManager') :: ModuleScript);
local CombatTable = require(ModulesFolder:WaitForChild('CombatTable') :: ModuleScript);
local StateHandler = require(ModulesFolder:WaitForChild('StateHandler') :: ModuleScript);
local WeaponHandler = require(ModulesFolder:WaitForChild('WeaponHandler') :: ModuleScript);



local DetectionRange: number = 65.0;
local AttackRange: number = 7.2;
local PassiveMaxKnockbackDistance: number = 60.0;
local PassiveIdleReturnDuration: number = 4.0;
local ManagedNPCMap: { [Model?]: boolean } = { };
local SpawnOriginMap: { [Model?]: CFrame } = { };



local function CreateR6LimbPart(ParentModel: Model, LimbName: string, SizeVector: Vector3, LimbColor: Color3, WorldCFrame: CFrame): (Part)
	local LimbPart: Part = Instance.new('Part');
	LimbPart.Name = LimbName;
	LimbPart.Size = SizeVector;
	LimbPart.Color = LimbColor;
	LimbPart.Material = (Enum.Material.SmoothPlastic);
	LimbPart.TopSurface = (Enum.SurfaceType.Smooth);
	LimbPart.BottomSurface = (Enum.SurfaceType.Smooth);
	LimbPart.CanCollide = false;
	LimbPart.Anchored = false;
	LimbPart.CFrame = WorldCFrame;
	LimbPart.Parent = ParentModel;

	return LimbPart;
end

local function CreateMotor6D(ParentPart: BasePart, MotorName: string, Part0: BasePart, Part1: BasePart, C0Matrix: CFrame, C1Matrix: CFrame): (Motor6D)
	local JointMotor: Motor6D = Instance.new('Motor6D');
	JointMotor.Name = MotorName;
	JointMotor.Part0 = Part0;
	JointMotor.Part1 = Part1;
	JointMotor.C0 = C0Matrix;
	JointMotor.C1 = C1Matrix;
	JointMotor.Parent = ParentPart;

	return JointMotor;
end

---> Spawns a complete, unanchored R6 combat rig NPC inside `Workspace.Live` with standard R6 `Motor6D` joints (`RootJoint`, `Neck`, `Right Shoulder`, `Left Shoulder`, `Right Hip`, `Left Hip`).
local function SpawnArenaNPC(LiveFolder: Folder, RigName: string, SpawnCFrame: CFrame, ArmorColor: Color3, WeaponStyle: string, IsPassiveDummy: boolean): (Model)
	local ExistingRig: Instance? = LiveFolder:FindFirstChild(RigName);

	if ExistingRig and ExistingRig:IsA('Model') then
		local ExistingTorso: Instance? = ExistingRig:FindFirstChild('Torso');
		local HasStandardR6Shoulder: boolean = (ExistingTorso ~= nil) and (ExistingTorso:FindFirstChild('Right Shoulder') ~= nil);

		if HasStandardR6Shoulder then
			local ExistingRoot: BasePart? = (ExistingRig:FindFirstChild('HumanoidRootPart') :: BasePart?);
			local ExistingHum: Humanoid? = ExistingRig:FindFirstChildOfClass('Humanoid');

			if ExistingRoot then
				ExistingRoot.Anchored = false;
				SpawnOriginMap[ExistingRig] = SpawnCFrame;
			end

			if ExistingHum then
				ExistingHum.DisplayDistanceType = (Enum.HumanoidDisplayDistanceType.None);
				ExistingHum.WalkSpeed = IsPassiveDummy and 0.0 or 16.0;
			end

			ExistingRig:SetAttribute('IsPassiveDummy', IsPassiveDummy);

			return ExistingRig;
		end

		ManagedNPCMap[ExistingRig] = nil;
		ExistingRig:Destroy();
	end

	local RigModel: Model = Instance.new('Model');
	RigModel.Name = RigName;
	RigModel:SetAttribute('IsPassiveDummy', IsPassiveDummy);
	RigModel:SetAttribute('LastCombatHitTime', 0.0);

	local RootPart: Part = Instance.new('Part');
	RootPart.Name = 'HumanoidRootPart';
	RootPart.Size = Vector3.new(2.0, 2.0, 1.0);
	RootPart.Transparency = 1.0;
	RootPart.CanCollide = true;
	RootPart.Anchored = false;
	RootPart.CFrame = SpawnCFrame;
	RootPart.Parent = RigModel;

	local TorsoPart: Part = CreateR6LimbPart(RigModel, 'Torso', Vector3.new(2.0, 2.0, 1.0), ArmorColor, SpawnCFrame);
	TorsoPart.CanCollide = true;

	local HeadPart: Part = CreateR6LimbPart(RigModel, 'Head', Vector3.new(2.0, 1.0, 1.0), Color3.fromRGB(235, 205, 175), (SpawnCFrame * CFrame.new(0.0, 1.5, 0.0)));
	local HeadMesh: SpecialMesh = Instance.new('SpecialMesh');
	HeadMesh.MeshType = (Enum.MeshType.Head);
	HeadMesh.Scale = Vector3.new(1.25, 1.25, 1.25);
	HeadMesh.Parent = HeadPart;

	local LeftArmPart: Part = CreateR6LimbPart(RigModel, 'Left Arm', Vector3.new(1.0, 2.0, 1.0), ArmorColor, (SpawnCFrame * CFrame.new(-1.5, 0.0, 0.0)));
	local RightArmPart: Part = CreateR6LimbPart(RigModel, 'Right Arm', Vector3.new(1.0, 2.0, 1.0), ArmorColor, (SpawnCFrame * CFrame.new(1.5, 0.0, 0.0)));
	local LeftLegPart: Part = CreateR6LimbPart(RigModel, 'Left Leg', Vector3.new(1.0, 2.0, 1.0), Color3.fromRGB(45, 50, 62), (SpawnCFrame * CFrame.new(-0.5, -2.0, 0.0)));
	local RightLegPart: Part = CreateR6LimbPart(RigModel, 'Right Leg', Vector3.new(1.0, 2.0, 1.0), Color3.fromRGB(45, 50, 62), (SpawnCFrame * CFrame.new(0.5, -2.0, 0.0)));

	local RootJointC0: CFrame = (CFrame.new(0.0, 0.0, 0.0) * CFrame.Angles(math.rad(-90.0), 0.0, math.rad(-180.0)));
	local RootJointC1: CFrame = (CFrame.new(0.0, 0.0, 0.0) * CFrame.Angles(math.rad(-90.0), 0.0, math.rad(-180.0)));
	CreateMotor6D(RootPart, 'RootJoint', RootPart, TorsoPart, RootJointC0, RootJointC1);

	local NeckC0: CFrame = (CFrame.new(0.0, 1.0, 0.0) * CFrame.Angles(math.rad(-90.0), 0.0, math.rad(-180.0)));
	local NeckC1: CFrame = (CFrame.new(0.0, -0.5, 0.0) * CFrame.Angles(math.rad(-90.0), 0.0, math.rad(-180.0)));
	CreateMotor6D(TorsoPart, 'Neck', TorsoPart, HeadPart, NeckC0, NeckC1);

	local RightShoulderC0: CFrame = (CFrame.new(1.0, 0.5, 0.0) * CFrame.Angles(0.0, math.rad(90.0), 0.0));
	local RightShoulderC1: CFrame = (CFrame.new(-0.5, 0.5, 0.0) * CFrame.Angles(0.0, math.rad(90.0), 0.0));
	CreateMotor6D(TorsoPart, 'Right Shoulder', TorsoPart, RightArmPart, RightShoulderC0, RightShoulderC1);

	local LeftShoulderC0: CFrame = (CFrame.new(-1.0, 0.5, 0.0) * CFrame.Angles(0.0, math.rad(-90.0), 0.0));
	local LeftShoulderC1: CFrame = (CFrame.new(0.5, 0.5, 0.0) * CFrame.Angles(0.0, math.rad(-90.0), 0.0));
	CreateMotor6D(TorsoPart, 'Left Shoulder', TorsoPart, LeftArmPart, LeftShoulderC0, LeftShoulderC1);

	local RightHipC0: CFrame = (CFrame.new(1.0, -1.0, 0.0) * CFrame.Angles(0.0, math.rad(90.0), 0.0));
	local RightHipC1: CFrame = (CFrame.new(0.5, 1.0, 0.0) * CFrame.Angles(0.0, math.rad(90.0), 0.0));
	CreateMotor6D(TorsoPart, 'Right Hip', TorsoPart, RightLegPart, RightHipC0, RightHipC1);

	local LeftHipC0: CFrame = (CFrame.new(-1.0, -1.0, 0.0) * CFrame.Angles(0.0, math.rad(-90.0), 0.0));
	local LeftHipC1: CFrame = (CFrame.new(-0.5, 1.0, 0.0) * CFrame.Angles(0.0, math.rad(-90.0), 0.0));
	CreateMotor6D(TorsoPart, 'Left Hip', TorsoPart, LeftLegPart, LeftHipC0, LeftHipC1);

	local RigHumanoid: Humanoid = Instance.new('Humanoid');
	RigHumanoid.MaxHealth = 250.0;
	RigHumanoid.Health = 250.0;
	RigHumanoid.WalkSpeed = IsPassiveDummy and 0.0 or 16.0;
	RigHumanoid.DisplayDistanceType = (Enum.HumanoidDisplayDistanceType.None);
	RigHumanoid.Parent = RigModel;

	local RigAnimator: Animator = Instance.new('Animator');
	RigAnimator.Parent = RigHumanoid;

	local NameplateBillboard: BillboardGui = Instance.new('BillboardGui');
	NameplateBillboard.Name = 'NPCHeaderBillboard';
	NameplateBillboard.Adornee = HeadPart;
	NameplateBillboard.Size = UDim2.new(0, 150, 0, 26);
	NameplateBillboard.StudsOffset = Vector3.new(0.0, 2.4, 0.0);
	NameplateBillboard.AlwaysOnTop = false;
	NameplateBillboard.MaxDistance = 75.0;
	NameplateBillboard.Parent = HeadPart;

	local TitleLabel: TextLabel = Instance.new('TextLabel');
	TitleLabel.Size = UDim2.new(1.0, 0, 1.0, 0);
	TitleLabel.BackgroundTransparency = 1.0;
	TitleLabel.Font = (Enum.Font.GothamBlack);
	TitleLabel.TextSize = 13;
	TitleLabel.TextColor3 = ArmorColor;
	TitleLabel.TextStrokeColor3 = Color3.fromRGB(10, 12, 18);
	TitleLabel.TextStrokeTransparency = 0.15;
	TitleLabel.Text = `{RigName} [{WeaponStyle}]`;
	TitleLabel.Parent = NameplateBillboard;

	RigModel.PrimaryPart = RootPart;
	RigModel.Parent = LiveFolder;
	SpawnOriginMap[RigModel] = SpawnCFrame;

	StateHandler.InitEntity(RigModel);
	WeaponHandler.EquipWeapon(RigModel, WeaponStyle);

	return RigModel;
end

local function FindNearestLivePlayer(OriginPosition: Vector3): (Model?, number)
	local ClosestCharacter: Model? = nil;
	local ClosestDistance: number = DetectionRange;

	for _: number, PlayerEntity: Player in Players:GetPlayers() do
		local CandidateChar: Model? = (PlayerEntity.Character);

		if CandidateChar then
			local CandidateHumanoid: Humanoid? = CandidateChar:FindFirstChildOfClass('Humanoid');
			local CandidateRoot: BasePart? = (CandidateChar:FindFirstChild('HumanoidRootPart') :: BasePart?);

			if CandidateHumanoid and CandidateRoot and ((CandidateHumanoid.Health) > 0) then
				local Distance: number = (((CandidateRoot.Position) - OriginPosition).Magnitude);

				if (Distance < ClosestDistance) then
					ClosestDistance = Distance;
					ClosestCharacter = CandidateChar;
				end
			end
		end
	end

	return ClosestCharacter, ClosestDistance;
end

local function ReturnDummyToSpawn(NPCModel: Model, NPCRoot: BasePart, NPCHumanoid: Humanoid, SpawnOriginCFrame: CFrame): ()
	NPCRoot.AssemblyLinearVelocity = Vector3.zero;
	NPCRoot.AssemblyAngularVelocity = Vector3.zero;
	NPCHumanoid.PlatformStand = false;
	NPCRoot.CFrame = SpawnOriginCFrame;

	return;
end

local function StartNPCLoop(NPCModel: Model): ()
	if ManagedNPCMap[NPCModel] then return end
	if Players:GetPlayerFromCharacter(NPCModel) then return end

	local NPCHumanoid: Humanoid? = NPCModel:FindFirstChildOfClass('Humanoid');
	local NPCRoot: BasePart? = (NPCModel:FindFirstChild('HumanoidRootPart') :: BasePart?);

	if not NPCHumanoid or not NPCRoot then return end

	ManagedNPCMap[NPCModel] = true;
	NPCRoot.Anchored = false;
	NPCHumanoid.DisplayDistanceType = (Enum.HumanoidDisplayDistanceType.None);
	StateHandler.InitEntity(NPCModel);

	local DefaultWeapon: string = (NPCModel.Name == 'AggressiveDummy') and 'Katana' or 'Sword';
	local CurrentWeapon: string = StateHandler.GetString(NPCModel, 'EquippedWeapon', DefaultWeapon);
	WeaponHandler.EquipWeapon(NPCModel, CurrentWeapon);

	local IsPassiveDummy: boolean = (NPCModel:GetAttribute('IsPassiveDummy') == true) or (NPCModel.Name == 'TrainingDummy');
	NPCModel:SetAttribute('IsPassiveDummy', IsPassiveDummy);

	local SpawnOriginCFrame: CFrame = SpawnOriginMap[NPCModel] or (NPCRoot.CFrame);
	SpawnOriginMap[NPCModel] = SpawnOriginCFrame;

	if not IsPassiveDummy then
		NPCHumanoid.WalkSpeed = 16.0;
	else
		NPCHumanoid.WalkSpeed = 0.0;
	end

	task.spawn(function(): ()
		while (NPCModel.Parent) do
			if ((NPCHumanoid.Health) <= 15.0) then
				NPCHumanoid.Health = (NPCHumanoid.MaxHealth);
				StateHandler.SetState(NPCModel, 'Posture', (CombatTable.MaxPosture));
			end

			if IsPassiveDummy then
				local DistanceFromSpawn: number = (((NPCRoot.Position) - (SpawnOriginCFrame.Position)).Magnitude);
				local LastHitClock: number = ((NPCModel:GetAttribute('LastCombatHitTime') :: number?) or 0.0);
				local IdleElapsed: number = (os.clock() - LastHitClock);
				local IsIncapacitated: boolean = StateHandler.GetBoolean(NPCModel, 'IsStunned') or StateHandler.GetBoolean(NPCModel, 'IsRagdolled');

				if (DistanceFromSpawn > PassiveMaxKnockbackDistance) or ((DistanceFromSpawn > 1.25) and (IdleElapsed >= PassiveIdleReturnDuration) and not IsIncapacitated) then
					ReturnDummyToSpawn(NPCModel, NPCRoot, NPCHumanoid, SpawnOriginCFrame);
				end

				if not IsIncapacitated and (NPCModel.Name == 'GuardDummy') then
					local ShouldGuard: boolean = (((math.floor(os.clock() / 4.0)) % 2) == 0);
					StateHandler.SetState(NPCModel, 'IsBlocking', ShouldGuard);

					if ShouldGuard then
						AnimationHandler.PlayAnimation(NPCModel, (AnimationRegistry.Block), (Enum.AnimationPriority.Action), 1.0, 'Block');
					else
						AnimationHandler.StopAnimation(NPCModel, (AnimationRegistry.Block), 0.15);
					end
				elseif not IsIncapacitated then
					StateHandler.SetState(NPCModel, 'IsBlocking', false);
				end

				task.wait(0.25);
				continue;
			end

			if StateHandler.GetBoolean(NPCModel, 'IsStunned') or StateHandler.GetBoolean(NPCModel, 'IsRagdolled') or StateHandler.GetBoolean(NPCModel, 'IsAttacking') then
				task.wait(0.1);
				continue;
			end

			NPCHumanoid.WalkSpeed = 16.0;
			local TargetCharacter: Model?, TargetDistance: number = FindNearestLivePlayer((NPCRoot.Position));

			if TargetCharacter then
				local TargetRoot: BasePart? = (TargetCharacter:FindFirstChild('HumanoidRootPart') :: BasePart?);

				if TargetRoot then
					if (TargetDistance <= AttackRange) then
						NPCHumanoid:MoveTo((NPCRoot.Position));

						local LookTarget: Vector3 = Vector3.new((TargetRoot.Position.X), (NPCRoot.Position.Y), (TargetRoot.Position.Z));

						if (((LookTarget - (NPCRoot.Position)).Magnitude) > 0.1) then
							NPCRoot.CFrame = CFrame.lookAt((NPCRoot.Position), LookTarget);
						end

						if StateHandler.GetBoolean(TargetCharacter, 'IsAttacking') and (math.random(1, 100) <= 25) then
							StateHandler.SetState(NPCModel, 'IsBlocking', true);
							AnimationHandler.PlayAnimation(NPCModel, (AnimationRegistry.Block), (Enum.AnimationPriority.Action), 1.0, 'Block');
							task.wait(0.45);
							StateHandler.SetState(NPCModel, 'IsBlocking', false);
							AnimationHandler.StopAnimation(NPCModel, (AnimationRegistry.Block), 0.12);
						else
							StateHandler.SetState(NPCModel, 'IsBlocking', false);
							CombatManager.ExecuteCharacterCombo(NPCModel);
							task.wait(0.38);
						end
					else
						StateHandler.SetState(NPCModel, 'IsBlocking', false);
						NPCHumanoid:MoveTo((TargetRoot.Position));
					end
				end
			else
				local DistanceFromHome: number = (((NPCRoot.Position) - (SpawnOriginCFrame.Position)).Magnitude);

				if (DistanceFromHome > 18.0) then
					NPCHumanoid:MoveTo((SpawnOriginCFrame.Position));
				end
			end

			task.wait(0.12);
		end

		ManagedNPCMap[NPCModel] = nil;
		SpawnOriginMap[NPCModel] = nil;

		return;
	end);

	return;
end



local ExistingLiveFolder: Folder? = (WS:FindFirstChild('Live') :: Folder?);

if not ExistingLiveFolder then
	local CreatedLiveFolder: Folder = Instance.new('Folder');
	CreatedLiveFolder.Name = 'Live';
	CreatedLiveFolder.Parent = WS;
	ExistingLiveFolder = CreatedLiveFolder;
end

local LiveFolder: Folder = (ExistingLiveFolder :: Folder);

local LegacyGladiator: Instance? = LiveFolder:FindFirstChild('ArenaGladiator');

if LegacyGladiator then
	LegacyGladiator:Destroy();
end

SpawnArenaNPC(LiveFolder, 'EnemyDummy', CFrame.new(0, 4.5, -9), Color3.fromRGB(255, 195, 75), 'Fists', true);
SpawnArenaNPC(LiveFolder, 'TrainingDummy', CFrame.new(-10, 4.5, -16), Color3.fromRGB(95, 175, 255), 'Sword', true);
SpawnArenaNPC(LiveFolder, 'GuardDummy', CFrame.new(10, 4.5, -16), Color3.fromRGB(115, 235, 165), 'Spear', true);
SpawnArenaNPC(LiveFolder, 'AggressiveDummy', CFrame.new(14, 4.5, -24), Color3.fromRGB(235, 75, 95), 'Katana', false);

for _: number, ChildObject: Instance in LiveFolder:GetChildren() do
	if ChildObject:IsA('Model') then
		StartNPCLoop(ChildObject);
	end
end

LiveFolder.ChildAdded:Connect(function(NewChild: Instance): ()
	if NewChild:IsA('Model') then
		task.wait(0.1);
		StartNPCLoop(NewChild);
	end

	return;
end);
