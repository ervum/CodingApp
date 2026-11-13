--!strict

local PhysicsService: PhysicsService = game:GetService('PhysicsService');
local Players: Players = game:GetService('Players');
local ReplicatedStorage: ReplicatedStorage = game:GetService('ReplicatedStorage');
local RS: RunService = game:GetService('RunService');
local WS: Workspace = game:GetService('Workspace');

local PrebootRemoteFolder: Folder? = (ReplicatedStorage:FindFirstChild('RemoteEvents') :: Folder?);

if not PrebootRemoteFolder then
	local NewRemoteFolder: Folder = Instance.new('Folder');
	NewRemoteFolder.Name = 'RemoteEvents';
	NewRemoteFolder.Parent = ReplicatedStorage;
	PrebootRemoteFolder = NewRemoteFolder;
end

local SafePrebootRemoteFolder: Folder = (PrebootRemoteFolder :: Folder);

if not SafePrebootRemoteFolder:FindFirstChild('CombatAction') then
	local NewCombatRemote: RemoteEvent = Instance.new('RemoteEvent');
	NewCombatRemote.Name = 'CombatAction';
	NewCombatRemote.Parent = SafePrebootRemoteFolder;
end

if not SafePrebootRemoteFolder:FindFirstChild('VFXReplication') then
	local NewVFXRemote: RemoteEvent = Instance.new('RemoteEvent');
	NewVFXRemote.Name = 'VFXReplication';
	NewVFXRemote.Parent = SafePrebootRemoteFolder;
end

if not WS:FindFirstChild('Live') then
	local NewLiveFolder: Folder = Instance.new('Folder');
	NewLiveFolder.Name = 'Live';
	NewLiveFolder.Parent = WS;
end

local ModulesFolder: Instance = ReplicatedStorage:WaitForChild('Modules');

local AnimationHandler = require(ModulesFolder:WaitForChild('AnimationHandler') :: ModuleScript);
local CombatManager = require(ModulesFolder:WaitForChild('CombatManager') :: ModuleScript);
local CombatTypes = require(ModulesFolder:WaitForChild('CombatTypes') :: ModuleScript);
local GliderHandler = require(ModulesFolder:WaitForChild('GliderHandler') :: ModuleScript);
local StateHandler = require(ModulesFolder:WaitForChild('StateHandler') :: ModuleScript);
local WallClimbHandler = require(ModulesFolder:WaitForChild('WallClimbHandler') :: ModuleScript);
local WeaponHandler = require(ModulesFolder:WaitForChild('WeaponHandler') :: ModuleScript);



type CombatActionPayload = CombatTypes.CombatActionPayload;



local LastActionTimestamps: { [Player?]: { [string?]: number } } = { };
local PeakDownwardSpeedMap: { [Model?]: number } = { };
local WasAirborneMap: { [Model?]: boolean } = { };



local function EnsureRuntimeHierarchy(): (RemoteEvent, Folder)
	local RemoteFolder: Folder? = (ReplicatedStorage:FindFirstChild('RemoteEvents') :: Folder?);

	if not RemoteFolder then
		local NewRemoteFolder: Folder = Instance.new('Folder');
		NewRemoteFolder.Name = 'RemoteEvents';
		NewRemoteFolder.Parent = ReplicatedStorage;
		RemoteFolder = NewRemoteFolder;
	end

	local SafeRemoteFolder: Folder = (RemoteFolder :: Folder);
	local CombatActionRemote: RemoteEvent? = (SafeRemoteFolder:FindFirstChild('CombatAction') :: RemoteEvent?);

	if not CombatActionRemote then
		local NewCombatRemote: RemoteEvent = Instance.new('RemoteEvent');
		NewCombatRemote.Name = 'CombatAction';
		NewCombatRemote.Parent = SafeRemoteFolder;
		CombatActionRemote = NewCombatRemote;
	end

	local VFXRemote: RemoteEvent? = (SafeRemoteFolder:FindFirstChild('VFXReplication') :: RemoteEvent?);

	if not VFXRemote then
		local NewVFXRemote: RemoteEvent = Instance.new('RemoteEvent');
		NewVFXRemote.Name = 'VFXReplication';
		NewVFXRemote.Parent = SafeRemoteFolder;
		VFXRemote = NewVFXRemote;
	end

	local LiveFolder: Folder? = (WS:FindFirstChild('Live') :: Folder?);

	if not LiveFolder then
		local NewLiveFolder: Folder = Instance.new('Folder');
		NewLiveFolder.Name = 'Live';
		NewLiveFolder.Parent = WS;
		LiveFolder = NewLiveFolder;
	end

	local MapFolder: Folder? = (WS:FindFirstChild('Map') :: Folder?);

	if not MapFolder then
		local NewMapFolder: Folder = Instance.new('Folder');
		NewMapFolder.Name = 'Map';
		NewMapFolder.Parent = WS;
		MapFolder = NewMapFolder;
	end

	local SafeMapFolder: Folder = (MapFolder :: Folder);

	if not WS:FindFirstChild('Baseplate') and not SafeMapFolder:FindFirstChild('ArenaBaseplate') then
		local FloorPart: Part = Instance.new('Part');
		FloorPart.Name = 'ArenaBaseplate';
		FloorPart.Size = Vector3.new(512.0, 16.0, 512.0);
		FloorPart.Position = Vector3.new(0.0, -8.0, 0.0);
		FloorPart.Anchored = true;
		FloorPart.CanCollide = true;
		FloorPart.Color = Color3.fromRGB(48, 52, 64);
		FloorPart.Material = (Enum.Material.Concrete);
		FloorPart.TopSurface = (Enum.SurfaceType.Smooth);
		FloorPart.BottomSurface = (Enum.SurfaceType.Smooth);
		FloorPart.Parent = SafeMapFolder;
	end

	WeaponHandler.EnsureWeaponAssets();

	local AssetsFolder: Instance? = ReplicatedStorage:FindFirstChild('Assets');
	local VFXFolder: Instance? = AssetsFolder and AssetsFolder:FindFirstChild('VFX') or nil;

	if VFXFolder then
		for _: number, DescendantObj: Instance in VFXFolder:GetDescendants() do
			if DescendantObj:IsA('BasePart') then
				DescendantObj.Transparency = 1.0;
				DescendantObj.CanCollide = false;
				DescendantObj.CanQuery = false;
				DescendantObj.CanTouch = false;
				DescendantObj.Massless = true;
			end
		end
	end

	pcall(function(): ()
		PhysicsService:RegisterCollisionGroup('Characters');
		PhysicsService:CollisionGroupSetCollidable('Characters', 'Characters', true);

		return;
	end);

	return (CombatActionRemote :: RemoteEvent), (LiveFolder :: Folder);
end

local function IsRateLimited(Player: Player, ActionName: string, MinInterval: number): (boolean)
	local PlayerBucket: { [string?]: number }? = LastActionTimestamps[Player];

	if not PlayerBucket then
		local NewBucket: { [string?]: number } = { };
		LastActionTimestamps[Player] = NewBucket;
		PlayerBucket = NewBucket;
	end

	local SafeBucket: { [string?]: number } = (PlayerBucket :: { [string?]: number });
	local CurrentClock: number = os.clock();
	local LastClock: number = (SafeBucket[ActionName] or 0.0);

	if ((CurrentClock - LastClock) < MinInterval) then
		return true;
	end

	SafeBucket[ActionName] = CurrentClock;

	return false;
end

local function AssignCharacterCollisionGroup(Character: Model): ()
	for _: number, DescendantObject: Instance in Character:GetDescendants() do
		if DescendantObject:IsA('BasePart') then
			pcall(function(): ()
				DescendantObject.CollisionGroup = 'Characters';

				return;
			end);
		end
	end

	return;
end



local CombatActionRemote: RemoteEvent, LiveFolder: Folder = EnsureRuntimeHierarchy();

local function OnCharacterAdded(Player: Player, Character: Model): ()
	StateHandler.InitEntity(Character);

	task.defer(function(): ()
		if (Character.Parent) and (Character.Parent ~= LiveFolder) then
			pcall(function(): ()
				Character.Parent = LiveFolder;

				return;
			end);
		end

		AssignCharacterCollisionGroup(Character);
		WeaponHandler.EquipWeapon(Character, 'Fists');

		return;
	end);

	Character.Destroying:Connect(function(): ()
		AnimationHandler.CleanupCache(Character);
		PeakDownwardSpeedMap[Character] = nil;
		WasAirborneMap[Character] = nil;

		return;
	end);

	return;
end

for _: number, ExistingPlayer: Player in Players:GetPlayers() do
	if (ExistingPlayer.Character) then
		OnCharacterAdded(ExistingPlayer, (ExistingPlayer.Character :: Model));
	end

	ExistingPlayer.CharacterAdded:Connect(function(NewCharacter: Model): ()
		OnCharacterAdded(ExistingPlayer, NewCharacter);

		return;
	end);
end

Players.PlayerAdded:Connect(function(JoiningPlayer: Player): ()
	JoiningPlayer.CharacterAdded:Connect(function(NewCharacter: Model): ()
		OnCharacterAdded(JoiningPlayer, NewCharacter);

		return;
	end);

	return;
end);

Players.PlayerRemoving:Connect(function(LeavingPlayer: Player): ()
	LastActionTimestamps[LeavingPlayer] = nil;

	return;
end);

CombatActionRemote.OnServerEvent:Connect(function(Player: Player, ActionName: string, PayloadData: CombatActionPayload?): ()
	if (typeof(ActionName) ~= 'string') or (type(ActionName) ~= 'string') then return end
	if (PayloadData ~= nil) and (typeof(PayloadData) ~= 'table') then return end

	local Character: Model? = (Player.Character);

	if not Character then return end

	local SafePayload: CombatActionPayload = (typeof(PayloadData) == 'table') and (PayloadData :: CombatActionPayload) or { };

	if (ActionName == 'LightAttack') then
		if IsRateLimited(Player, 'LightAttack', 0.08) then return end

		CombatManager.LightAttack(Player);
	elseif (ActionName == 'HeavyAttack') then
		if IsRateLimited(Player, 'HeavyAttack', 0.2) then return end

		CombatManager.HeavyAttack(Player);
	elseif (ActionName == 'AirSlam') then
		if IsRateLimited(Player, 'AirSlam', 0.25) then return end

		CombatManager.AirSlam(Player);
	elseif (ActionName == 'Block') then
		if IsRateLimited(Player, 'Block', 0.05) then return end

		local BlockState: boolean = (typeof(SafePayload.State) == 'boolean') and (SafePayload.State == true) or false;
		CombatManager.Block(Player, BlockState);
	elseif (ActionName == 'Dash') then
		if IsRateLimited(Player, 'Dash', 0.15) then return end

		local RawDir: Vector3? = (typeof(SafePayload.Direction) == 'Vector3') and (SafePayload.Direction) or nil;
		local ValidDir: Vector3? = nil;

		if RawDir and ((RawDir.X) == (RawDir.X)) and ((RawDir.Y) == (RawDir.Y)) and ((RawDir.Z) == (RawDir.Z)) then
			ValidDir = RawDir;
		end

		local ValidDashKey: string? = (typeof(SafePayload.DashKey) == 'string') and (SafePayload.DashKey) or nil;
		CombatManager.Dash(Player, ValidDir, ValidDashKey);
	elseif (ActionName == 'ActivateRage') then
		if IsRateLimited(Player, 'ActivateRage', 0.25) then return end

		CombatManager.ActivateRage(Player);
	elseif (ActionName == 'SwitchWeapon') then
		if IsRateLimited(Player, 'SwitchWeapon', 0.2) then return end

		local RequestedStyle: string = (typeof(SafePayload.WeaponName) == 'string') and (SafePayload.WeaponName :: string) or 'Fists';
		CombatManager.SwitchWeapon(Player, RequestedStyle);
	elseif (ActionName == 'WallClimb') then
		if IsRateLimited(Player, 'WallClimb', 0.05) then return end

		local ShouldClimb: boolean = (typeof(SafePayload.State) == 'boolean') and (SafePayload.State == true) or false;

		if ShouldClimb then
			WallClimbHandler.StartClimb(Character);
		else
			WallClimbHandler.StopClimb(Character, true);
		end
	elseif (ActionName == 'WallRun') then
		if IsRateLimited(Player, 'WallRun', 0.05) then return end

		local ShouldRun: boolean = (typeof(SafePayload.State) == 'boolean') and (SafePayload.State == true) or false;

		if ShouldRun then
			WallClimbHandler.StartWallRun(Character);
		else
			WallClimbHandler.StopWallRun(Character, true);
		end
	elseif (ActionName == 'Glide') then
		if IsRateLimited(Player, 'Glide', 0.05) then return end

		local ShouldGlide: boolean = (typeof(SafePayload.State) == 'boolean') and (SafePayload.State == true) or false;

		if ShouldGlide then
			GliderHandler.EquipGlider(Character);
		else
			GliderHandler.UnequipGlider(Character);
		end
	end

	return;
end);

RS.Heartbeat:Connect(function(DeltaTime: number): ()
	for _: number, PlayerEntity: Player in Players:GetPlayers() do
		local Character: Model? = (PlayerEntity.Character);

		if Character then
			WallClimbHandler.UpdateCharacter(Character, DeltaTime);
			GliderHandler.UpdateCharacter(Character, DeltaTime);

			local RootPart: BasePart? = (Character:FindFirstChild('HumanoidRootPart') :: BasePart?);
			local Humanoid: Humanoid? = Character:FindFirstChildOfClass('Humanoid');

			if RootPart and Humanoid and ((Humanoid.Health) > 0) then
				local IsAirborne: boolean = ((Humanoid.FloorMaterial) == (Enum.Material.Air));
				local VerticalVelocity: number = (RootPart.AssemblyLinearVelocity.Y);

				if IsAirborne then
					WasAirborneMap[Character] = true;
					local DownwardSpeed: number = math.max(0.0, (-VerticalVelocity));
					local PreviousPeak: number = (PeakDownwardSpeedMap[Character] or 0.0);

					if (DownwardSpeed > PreviousPeak) then
						PeakDownwardSpeedMap[Character] = DownwardSpeed;
					end
				elseif WasAirborneMap[Character] then
					local RecordedPeak: number = (PeakDownwardSpeedMap[Character] or 0.0);
					WasAirborneMap[Character] = false;
					PeakDownwardSpeedMap[Character] = 0.0;

					if (RecordedPeak > 0.0) then
						WallClimbHandler.ApplyFallDamage(Character, RecordedPeak);
					end
				end
			end
		end
	end

	return;
end);
