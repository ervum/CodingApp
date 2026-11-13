--!strict

local Players: Players = game:GetService('Players');
local ReplicatedStorage: ReplicatedStorage = game:GetService('ReplicatedStorage');
local UIS: UserInputService = game:GetService('UserInputService');
local WS: Workspace = game:GetService('Workspace');

local ModulesFolder: Instance = ReplicatedStorage:WaitForChild('Modules');
local RemoteFolder: Instance = ReplicatedStorage:WaitForChild('RemoteEvents');

local CombatTable = require(ModulesFolder:WaitForChild('CombatTable') :: ModuleScript);
local StateHandler = require(ModulesFolder:WaitForChild('StateHandler') :: ModuleScript);

local CombatActionRemote: RemoteEvent = (RemoteFolder:WaitForChild('CombatAction') :: RemoteEvent);



local LocalPlayer: Player = Players.LocalPlayer;
local LastSpacePressClock: number = 0.0;
local DoubleTapThreshold: number = 0.34;



local function CheckWallProximity(Character: Model): (boolean, boolean)
	local RootPart: BasePart? = (Character:FindFirstChild('HumanoidRootPart') :: BasePart?);

	if not RootPart then
		return false, false;
	end

	local RayParams: RaycastParams = RaycastParams.new();
	RayParams.FilterType = (Enum.RaycastFilterType.Exclude);
	RayParams.FilterDescendantsInstances = { Character };

	local ForwardVector: Vector3 = (((RootPart.CFrame.LookVector).Unit) * (CombatTable.WallDetectionDistance));
	local FrontalHit: RaycastResult? = WS:Raycast((RootPart.Position), ForwardVector, RayParams);

	if FrontalHit then
		return true, false;
	end

	local RightVector: Vector3 = (((RootPart.CFrame.RightVector).Unit) * (CombatTable.WallRunSideRayDistance));
	local RightHit: RaycastResult? = WS:Raycast((RootPart.Position), RightVector, RayParams);

	if RightHit then
		return false, true;
	end

	local LeftHit: RaycastResult? = WS:Raycast((RootPart.Position), (-RightVector), RayParams);

	if LeftHit then
		return false, true;
	end

	return false, false;
end



UIS.InputBegan:Connect(function(InputObject: InputObject, GameProcessed: boolean): ()
	if GameProcessed then return end

	if (InputObject.KeyCode ~= (Enum.KeyCode.Space)) then return end

	local Character: Model? = (LocalPlayer.Character);

	if not Character then return end

	local Humanoid: Humanoid? = Character:FindFirstChildOfClass('Humanoid');

	if not Humanoid or ((Humanoid.Health) <= 0) then return end

	local CurrentClock: number = os.clock();
	local TimeSinceLastSpace: number = (CurrentClock - LastSpacePressClock);
	LastSpacePressClock = CurrentClock;

	local IsAirborne: boolean = ((Humanoid.FloorMaterial) == (Enum.Material.Air));
	local HasFrontalWall: boolean, HasLateralWall: boolean = CheckWallProximity(Character);

	if HasFrontalWall then
		CombatActionRemote:FireServer('WallClimb', { State = true });

		return;
	end

	if IsAirborne and HasLateralWall then
		CombatActionRemote:FireServer('WallRun', { State = true });

		return;
	end

	if IsAirborne and (TimeSinceLastSpace <= DoubleTapThreshold) then
		local CurrentlyGliding: boolean = StateHandler.GetBoolean(Character, 'IsGliding');
		CombatActionRemote:FireServer('Glide', { State = (not CurrentlyGliding) });
	end

	return;
end);

UIS.InputEnded:Connect(function(InputObject: InputObject, _: boolean): ()
	if (InputObject.KeyCode ~= (Enum.KeyCode.Space)) then return end

	local Character: Model? = (LocalPlayer.Character);

	if not Character then return end

	if StateHandler.GetBoolean(Character, 'IsClimbing') then
		CombatActionRemote:FireServer('WallClimb', { State = false });
	end

	if StateHandler.GetBoolean(Character, 'IsWallRunning') then
		CombatActionRemote:FireServer('WallRun', { State = false });
	end

	return;
end);
