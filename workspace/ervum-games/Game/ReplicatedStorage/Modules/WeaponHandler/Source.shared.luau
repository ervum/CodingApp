--!strict

local ReplicatedStorage: ReplicatedStorage = game:GetService('ReplicatedStorage');
local ModulesFolder: Instance = ReplicatedStorage:WaitForChild('Modules');

local CombatTypes = require(ModulesFolder:WaitForChild('CombatTypes') :: ModuleScript);
local StateHandler = require(ModulesFolder:WaitForChild('StateHandler') :: ModuleScript);
local WeaponConfig = require(ModulesFolder:WaitForChild('WeaponConfig') :: ModuleScript);



export type WeaponDescriptor = CombatTypes.WeaponDescriptor;

export type WeaponHandlerModule = {
	EnsureWeaponAssets: (() -> (Folder)),
	EquipWeapon:        ((Model, string) -> ()),
	UnequipCurrent:     ((Model) -> ()),
};



local CanonicalLimbNames: { [string?]: boolean } = {
	['Head']              = true,
	['Torso']             = true,
	['Left Arm']          = true,
	['Right Arm']         = true,
	['Left Leg']          = true,
	['Right Leg']         = true,
	['HumanoidRootPart']  = true,
	['UpperTorso']        = true,
	['LowerTorso']        = true,
	['LeftUpperArm']      = true,
	['LeftLowerArm']      = true,
	['LeftHand']          = true,
	['RightUpperArm']     = true,
	['RightLowerArm']     = true,
	['RightHand']         = true,
	['LeftUpperLeg']      = true,
	['LeftLowerLeg']      = true,
	['LeftFoot']          = true,
	['RightUpperLeg']     = true,
	['RightLowerLeg']     = true,
	['RightFoot']         = true,
};



---> Repositions all internal `BasePart`/`MeshPart` descendants relative to <HandlePart> and welds them via `WeldConstraint` before hand Motor6D attachment.
local function PositionAndWeldWeaponToHandle(WeaponModel: Model, HandlePart: BasePart, TargetHandleCFrame: CFrame): ()
	local RelativeCFrameMap: { [BasePart?]: CFrame } = { };
	local DescendantParts: { [number?]: BasePart } = { };
	local BaseHandleCFrame: CFrame = (HandlePart.CFrame);

	for _: number, DescendantObject: Instance in WeaponModel:GetDescendants() do
		if DescendantObject:IsA('BasePart') then
			RelativeCFrameMap[DescendantObject] = BaseHandleCFrame:ToObjectSpace((DescendantObject.CFrame));
			table.insert(DescendantParts, DescendantObject);
		elseif DescendantObject:IsA('WeldConstraint') or DescendantObject:IsA('Motor6D') or DescendantObject:IsA('Weld') then
			DescendantObject:Destroy();
		end
	end

	HandlePart.Anchored = false;
	HandlePart.CanCollide = false;
	HandlePart.CanQuery = false;
	HandlePart.CanTouch = false;
	HandlePart.Massless = true;
	HandlePart.CFrame = TargetHandleCFrame;

	for _: number?, DescendantPart: BasePart in DescendantParts do
		if (DescendantPart ~= HandlePart) then
			local RelativeOffset: CFrame = (RelativeCFrameMap[DescendantPart] or CFrame.identity);

			DescendantPart.Anchored = false;
			DescendantPart.CanCollide = false;
			DescendantPart.CanQuery = false;
			DescendantPart.CanTouch = false;
			DescendantPart.Massless = true;
			DescendantPart.CFrame = (TargetHandleCFrame * RelativeOffset);

			local PartWeld: WeldConstraint = Instance.new('WeldConstraint');
			PartWeld.Name = `WeldToHandle_{DescendantPart.Name}`;
			PartWeld.Part0 = HandlePart;
			PartWeld.Part1 = DescendantPart;
			PartWeld.Parent = HandlePart;
		end
	end

	WeaponModel.PrimaryPart = HandlePart;

	return;
end

local function NormalizeBowTemplate(BowModel: Model): ()
	if (BowModel:GetAttribute('IsForwardNormalized') == true) and BowModel:FindFirstChild('Handle') then
		return;
	end

	local BodyMesh: BasePart? = (BowModel:FindFirstChild('PT_Bow_01_a_body') :: BasePart?);
	local StringMesh: BasePart? = (BowModel:FindFirstChild('PT_Bow_01_a_string') :: BasePart?);
	local OldRoot: BasePart? = (BowModel:FindFirstChild('RootPart') :: BasePart?);

	if OldRoot then
		OldRoot.Transparency = 1.0;
		OldRoot.CanCollide = false;
		OldRoot.CanQuery = false;
		OldRoot.CanTouch = false;
		OldRoot.Massless = true;
	end

	if not BodyMesh then return end

	local SafeBody: BasePart = (BodyMesh :: BasePart);
	local GripPosition: Vector3 = (SafeBody.Position);
	local ForwardDir: Vector3 = (SafeBody.CFrame.RightVector);

	if StringMesh then
		local StringToBody: Vector3 = ((SafeBody.Position) - (StringMesh.Position));
		local PlanarDelta: Vector3 = Vector3.new((StringToBody.X), 0.0, (StringToBody.Z));

		if ((PlanarDelta.Magnitude) > 0.05) then
			ForwardDir = (PlanarDelta.Unit);
		end
	end

	local ExistingHandle: BasePart? = (BowModel:FindFirstChild('Handle') :: BasePart?);
	local BowHandle: BasePart = ExistingHandle or Instance.new('Part');
	BowHandle.Name = 'Handle';
	BowHandle.Size = Vector3.new(0.3, 1.1, 0.3);
	BowHandle.Transparency = 1.0;
	BowHandle.CanCollide = false;
	BowHandle.CanQuery = false;
	BowHandle.CanTouch = false;
	BowHandle.Massless = true;
	BowHandle.Anchored = true;
	BowHandle.CFrame = CFrame.lookAt(GripPosition, (GripPosition + ForwardDir), (SafeBody.CFrame.UpVector));
	BowHandle.Parent = BowModel;

	for _: number, DescendantObject: Instance in BowModel:GetDescendants() do
		if DescendantObject:IsA('Motor6D') or DescendantObject:IsA('Weld') or DescendantObject:IsA('WeldConstraint') then
			DescendantObject:Destroy();
		elseif DescendantObject:IsA('BasePart') then
			DescendantObject.Anchored = true;
			DescendantObject.CanCollide = false;
			DescendantObject.CanQuery = false;
			DescendantObject.CanTouch = false;
			DescendantObject.Massless = true;

			if (DescendantObject ~= BowHandle) then
				local InternalWeld: WeldConstraint = Instance.new('WeldConstraint');
				InternalWeld.Name = `BowWeld_{DescendantObject.Name}`;
				InternalWeld.Part0 = BowHandle;
				InternalWeld.Part1 = DescendantObject;
				InternalWeld.Parent = BowHandle;
			end
		end
	end

	BowModel.PrimaryPart = BowHandle;
	BowModel:SetAttribute('IsForwardNormalized', true);

	return;
end

local function CreateProceduralWeaponTemplate(WeaponsFolder: Folder, StyleName: string, BladeSize: Vector3, BladeForwardOffset: number, BladeColor: Color3): ()
	local ExistingTemplate: Instance? = WeaponsFolder:FindFirstChild(StyleName);

	if ExistingTemplate then
		if (ExistingTemplate:GetAttribute('IsForwardNormalized') == true) then
			return;
		end

		ExistingTemplate:Destroy();
	end

	local TemplateModel: Model = Instance.new('Model');
	TemplateModel.Name = StyleName;
	TemplateModel:SetAttribute('IsForwardNormalized', true);

	local BaseOriginCFrame: CFrame = CFrame.new(0.0, 0.0, 0.0);

	local HandlePart: Part = Instance.new('Part');
	HandlePart.Name = 'Handle';
	HandlePart.Size = Vector3.new(0.32, 0.32, 1.25);
	HandlePart.Color = Color3.fromRGB(45, 45, 55);
	HandlePart.Material = (Enum.Material.Metal);
	HandlePart.CanCollide = false;
	HandlePart.CanQuery = false;
	HandlePart.CanTouch = false;
	HandlePart.Anchored = true;
	HandlePart.Massless = true;
	HandlePart.CFrame = BaseOriginCFrame;
	HandlePart.Parent = TemplateModel;

	local GuardPart: Part = Instance.new('Part');
	GuardPart.Name = 'Guard';
	GuardPart.Size = Vector3.new(1.05, 0.45, 0.22);
	GuardPart.Color = Color3.fromRGB(205, 170, 75);
	GuardPart.Material = (Enum.Material.Metal);
	GuardPart.CanCollide = false;
	GuardPart.CanQuery = false;
	GuardPart.CanTouch = false;
	GuardPart.Anchored = true;
	GuardPart.Massless = true;
	GuardPart.CFrame = (BaseOriginCFrame * CFrame.new(0.0, 0.0, -0.62));
	GuardPart.Parent = TemplateModel;

	local BladePart: Part = Instance.new('Part');
	BladePart.Name = 'Blade';
	BladePart.Size = BladeSize;
	BladePart.Color = BladeColor;
	BladePart.Material = (Enum.Material.Neon);
	BladePart.CanCollide = false;
	BladePart.CanQuery = false;
	BladePart.CanTouch = false;
	BladePart.Anchored = true;
	BladePart.Massless = true;
	BladePart.CFrame = (BaseOriginCFrame * CFrame.new(0.0, 0.0, (-BladeForwardOffset)));
	BladePart.Parent = TemplateModel;

	local GuardWeld: WeldConstraint = Instance.new('WeldConstraint');
	GuardWeld.Name = 'WeldToHandle_Guard';
	GuardWeld.Part0 = HandlePart;
	GuardWeld.Part1 = GuardPart;
	GuardWeld.Parent = HandlePart;

	local BladeWeld: WeldConstraint = Instance.new('WeldConstraint');
	BladeWeld.Name = 'WeldToHandle_Blade';
	BladeWeld.Part0 = HandlePart;
	BladeWeld.Part1 = BladePart;
	BladeWeld.Parent = HandlePart;

	local HalfBladeLength: number = ((BladeSize.Z) * 0.48);

	local AttachmentTip: Attachment = Instance.new('Attachment');
	AttachmentTip.Name = 'TrailTop';
	AttachmentTip.Position = Vector3.new(0.0, 0.0, (-HalfBladeLength));
	AttachmentTip.Parent = BladePart;

	local AttachmentBase: Attachment = Instance.new('Attachment');
	AttachmentBase.Name = 'TrailBottom';
	AttachmentBase.Position = Vector3.new(0.0, 0.0, HalfBladeLength);
	AttachmentBase.Parent = BladePart;

	local WeaponTrail: Trail = Instance.new('Trail');
	WeaponTrail.Name = 'WeaponTrail';
	WeaponTrail.Attachment0 = AttachmentTip;
	WeaponTrail.Attachment1 = AttachmentBase;
	WeaponTrail.Lifetime = 0.18;
	WeaponTrail.LightEmission = 0.85;
	WeaponTrail.Color = ColorSequence.new(BladeColor, Color3.fromRGB(255, 255, 255));
	WeaponTrail.Transparency = NumberSequence.new(0.15, 1.0);
	WeaponTrail.Enabled = true;
	WeaponTrail.Parent = BladePart;

	TemplateModel.PrimaryPart = HandlePart;
	TemplateModel.Parent = WeaponsFolder;

	return;
end

---> Ensures `ReplicatedStorage.Assets.Weapons` exists and populates forward-aligned weapon and glider templates.
local function EnsureWeaponAssets(): (Folder)
	local AssetsFolder: Folder? = (ReplicatedStorage:FindFirstChild('Assets') :: Folder?);

	if not AssetsFolder then
		local NewAssets: Folder = Instance.new('Folder');
		NewAssets.Name = 'Assets';
		NewAssets.Parent = ReplicatedStorage;
		AssetsFolder = NewAssets;
	end

	local SafeAssets: Folder = (AssetsFolder :: Folder);
	local WeaponsFolder: Folder? = (SafeAssets:FindFirstChild('Weapons') :: Folder?);

	if not WeaponsFolder then
		local NewWeapons: Folder = Instance.new('Folder');
		NewWeapons.Name = 'Weapons';
		NewWeapons.Parent = SafeAssets;
		WeaponsFolder = NewWeapons;
	end

	local SafeWeapons: Folder = (WeaponsFolder :: Folder);

	CreateProceduralWeaponTemplate(SafeWeapons, 'Sword', Vector3.new(0.22, 0.52, 3.8), 2.5, Color3.fromRGB(95, 175, 255));
	CreateProceduralWeaponTemplate(SafeWeapons, 'Katana', Vector3.new(0.15, 0.34, 4.2), 2.7, Color3.fromRGB(255, 85, 125));
	CreateProceduralWeaponTemplate(SafeWeapons, 'Spear', Vector3.new(0.26, 0.26, 5.6), 3.3, Color3.fromRGB(90, 235, 165));

	local ExistingBow: Instance? = SafeWeapons:FindFirstChild('Bow');

	if ExistingBow and ExistingBow:IsA('Model') then
		NormalizeBowTemplate(ExistingBow);
	else
		CreateProceduralWeaponTemplate(SafeWeapons, 'Bow', Vector3.new(0.25, 3.6, 0.9), 0.4, Color3.fromRGB(185, 130, 255));
	end

	if not SafeWeapons:FindFirstChild('Glider') then
		local GliderModel: Model = Instance.new('Model');
		GliderModel.Name = 'Glider';

		local GliderHandle: Part = Instance.new('Part');
		GliderHandle.Name = 'Handle';
		GliderHandle.Size = Vector3.new(7.5, 0.2, 2.6);
		GliderHandle.Color = Color3.fromRGB(70, 175, 255);
		GliderHandle.Material = (Enum.Material.Neon);
		GliderHandle.Transparency = 0.25;
		GliderHandle.Anchored = true;
		GliderHandle.CanCollide = false;
		GliderHandle.Massless = true;
		GliderHandle.Parent = GliderModel;

		GliderModel.PrimaryPart = GliderHandle;
		GliderModel.Parent = SafeWeapons;
	end

	return SafeWeapons;
end

local function StripStrayHandBlocks(Character: Model): ()
	local HandLimbNames: { [number?]: string } = {
		[1] = 'Right Arm',
		[2] = 'Left Arm',
		[3] = 'RightHand',
		[4] = 'LeftHand',
	};

	for _: number?, LimbName: string in HandLimbNames do
		local LimbInstance: Instance? = Character:FindFirstChild(LimbName);

		if LimbInstance then
			for _: number, ChildItem: Instance in LimbInstance:GetChildren() do
				if ChildItem:IsA('BasePart') or (ChildItem.Name == 'WeaponGripMotor') or (ChildItem.Name == 'FistBlock') then
					ChildItem:Destroy();
				end
			end
		end
	end

	for _: number, CharChild: Instance in Character:GetChildren() do
		if CharChild:IsA('BasePart') and not CanonicalLimbNames[CharChild.Name] then
			CharChild:Destroy();
		elseif CharChild:IsA('Model') and ((CharChild.Name == 'Fists') or (CharChild.Name == 'FistModel')) then
			CharChild:Destroy();
		end
	end

	return;
end

---> Destroys any currently welded 3D weapon model and stray hand placeholder blocks on <Character>.
local function UnequipCurrent(Character: Model): ()
	if not Character then return end

	local ExistingWeapon: Instance? = Character:FindFirstChild('EquippedWeaponModel');

	if ExistingWeapon then
		ExistingWeapon:Destroy();
	end

	StripStrayHandBlocks(Character);

	return;
end

---> Equips and welds the 3D weapon model for <WeaponName> onto <Character>'s right hand or arm.
local function EquipWeapon(Character: Model, WeaponName: string): ()
	if not Character then return end

	local WeaponData: WeaponDescriptor = WeaponConfig.GetWeapon(WeaponName);
	local ResolvedStyle: string = (WeaponData.DisplayName);

	UnequipCurrent(Character);
	StateHandler.SetState(Character, 'EquippedWeapon', ResolvedStyle);
	StateHandler.SetState(Character, 'Combo', 1);

	if (WeaponData.ModelName == 'None') then
		return;
	end

	local WeaponsFolder: Folder = EnsureWeaponAssets();
	local WeaponTemplate: Instance? = WeaponsFolder:FindFirstChild(WeaponData.ModelName);

	if not WeaponTemplate or not WeaponTemplate:IsA('Model') then
		return;
	end

	local RightHandPart: BasePart? = (Character:FindFirstChild('RightHand') :: BasePart?);
	local RightArmPart: BasePart? = (Character:FindFirstChild('Right Arm') :: BasePart?);
	local RightGripLimb: BasePart? = RightHandPart or RightArmPart;

	if not RightGripLimb then return end

	local ClonedWeapon: Model = WeaponTemplate:Clone();
	ClonedWeapon.Name = 'EquippedWeaponModel';

	local HandlePart: BasePart? = (ClonedWeapon:FindFirstChild('Handle') :: BasePart?) or (ClonedWeapon.PrimaryPart) or (ClonedWeapon:FindFirstChild('RootPart') :: BasePart?) or ClonedWeapon:FindFirstChildWhichIsA('BasePart');

	if not HandlePart then
		ClonedWeapon:Destroy();

		return;
	end

	local SafeHandle: BasePart = (HandlePart :: BasePart);
	local ResolvedGripOffset: CFrame = (WeaponData.GripOffset);

	if RightHandPart then
		ResolvedGripOffset = CFrame.new(0.0, -0.15, (ResolvedGripOffset.Position.Z));
	end

	local TargetHandleCFrame: CFrame = ((RightGripLimb.CFrame) * ResolvedGripOffset);
	PositionAndWeldWeaponToHandle(ClonedWeapon, SafeHandle, TargetHandleCFrame);

	ClonedWeapon.Parent = Character;

	local GripMotor: Motor6D = Instance.new('Motor6D');
	GripMotor.Name = 'WeaponGripMotor';
	GripMotor.Part0 = RightGripLimb;
	GripMotor.Part1 = SafeHandle;
	GripMotor.C0 = ResolvedGripOffset;
	GripMotor.C1 = CFrame.identity;
	GripMotor.Parent = RightGripLimb;

	return;
end



local WeaponHandler: WeaponHandlerModule = {
	EnsureWeaponAssets = EnsureWeaponAssets,
	EquipWeapon        = EquipWeapon,
	UnequipCurrent     = UnequipCurrent,
};



return WeaponHandler;
