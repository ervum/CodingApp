--!strict

local ContentProvider: ContentProvider = game:GetService('ContentProvider');
local ReplicatedStorage: ReplicatedStorage = game:GetService('ReplicatedStorage');

local ModulesFolder: Instance = ReplicatedStorage:WaitForChild('Modules');
local AnimationRegistry = require(ModulesFolder:WaitForChild('AnimationRegistry') :: ModuleScript);



local RegisteredIDMap: { [string?]: boolean } = { };
local PreloadInstances: { [number?]: Animation } = { };



local function RegisterAnimationID(AnimationID: string?): ()
	if not AnimationID or (AnimationID == '') or (AnimationID == 'rbxassetid://0') then
		return;
	end

	if RegisteredIDMap[AnimationID] then
		return;
	end

	RegisteredIDMap[AnimationID] = true;

	local AnimInstance: Animation = Instance.new('Animation');
	AnimInstance.AnimationId = AnimationID;
	table.insert(PreloadInstances, AnimInstance);

	return;
end

local function CollectMapAnimations(AnimTable: { [number?]: string }): ()
	for _: number?, AssetID: string in AnimTable do
		RegisterAnimationID(AssetID);
	end

	return;
end



CollectMapAnimations(AnimationRegistry.Fists);
CollectMapAnimations(AnimationRegistry.Sword);
CollectMapAnimations(AnimationRegistry.Katana);
CollectMapAnimations(AnimationRegistry.Spear);
CollectMapAnimations(AnimationRegistry.Bow);

RegisterAnimationID(AnimationRegistry.HeavyAttack);
RegisterAnimationID(AnimationRegistry.AirSlam);
RegisterAnimationID(AnimationRegistry.Block);
RegisterAnimationID(AnimationRegistry.Parry);
RegisterAnimationID(AnimationRegistry.WallClimb);
RegisterAnimationID(AnimationRegistry.WallRunLeft);
RegisterAnimationID(AnimationRegistry.WallRunRight);
RegisterAnimationID(AnimationRegistry.Glider);
RegisterAnimationID(AnimationRegistry.RageAwaken);

for _: string?, DashAssetID: string in AnimationRegistry.Dash do
	RegisterAnimationID(DashAssetID);
end

task.spawn(function(): ()
	pcall(function(): ()
		ContentProvider:PreloadAsync(PreloadInstances :: { [number]: Instance });

		return;
	end);

	for _: number?, AnimObject: Animation in PreloadInstances do
		AnimObject:Destroy();
	end

	return;
end);
