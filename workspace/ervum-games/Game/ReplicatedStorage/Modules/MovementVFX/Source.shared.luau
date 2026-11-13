--!strict

local D: Debris = game:GetService('Debris');
local ReplicatedStorage: ReplicatedStorage = game:GetService('ReplicatedStorage');
local RS: RunService = game:GetService('RunService');
local TS: TweenService = game:GetService('TweenService');
local WS: Workspace = game:GetService('Workspace');

local ModulesFolder: Instance = ReplicatedStorage:WaitForChild('Modules');
local CombatTable = require(ModulesFolder:WaitForChild('CombatTable') :: ModuleScript);



type FloatingDebrisEntry = {
	CubePart:   Part,
	SpinVector: Vector3,
	RiseSpeed:  number,
};

export type MovementVFXModule = {
	SanitizeVFXTemplates:   (() -> ()),
	SpawnUnpackedVFX:       ((string, CFrame, BasePart?, number?) -> (Instance?)),
	PlaySlashVFX:           ((Model, string?, boolean?, number?) -> ()),
	PlayHitVFX:             ((Instance, boolean?, string?) -> ()),
	PlayExplosionShockwave: ((Vector3, number, Color3?, boolean?) -> ()),
	PlayRageGroundShatter:  ((Model) -> ()),
	PlayVanishVFX:          ((Model, Vector3, Vector3) -> ()),
	SetRageAuraActive:      ((Model, boolean) -> ()),
	SpawnDashAfterimage:    ((Model, Vector3?) -> ()),
	SpawnWallDust:          ((Vector3, Vector3) -> ()),
	ManageGliderTrail:      ((Model, boolean) -> ()),
};



local LimbFallbackMap: { [string?]: { [number?]: string } } = {
	['HumanoidRootPart'] = { [1] = 'HumanoidRootPart' },
	['Head']             = { [1] = 'Head' },
	['Torso']            = { [1] = 'Torso', [2] = 'UpperTorso', [3] = 'LowerTorso' },
	['Left Arm']         = { [1] = 'Left Arm', [2] = 'LeftHand', [3] = 'LeftLowerArm' },
	['Right Arm']        = { [1] = 'Right Arm', [2] = 'RightHand', [3] = 'RightLowerArm' },
	['Left Leg']         = { [1] = 'Left Leg', [2] = 'LeftFoot', [3] = 'LeftLowerLeg' },
	['Right Leg']        = { [1] = 'Right Leg', [2] = 'RightFoot', [3] = 'RightLowerLeg' },
};

local CanonicalCharacterLimbs: { [string?]: boolean } = {
	['Head']          = true,
	['Torso']         = true,
	['Left Arm']      = true,
	['Right Arm']     = true,
	['Left Leg']      = true,
	['Right Leg']     = true,
	['UpperTorso']    = true,
	['LowerTorso']    = true,
	['LeftUpperArm']  = true,
	['LeftLowerArm']  = true,
	['LeftHand']      = true,
	['RightUpperArm'] = true,
	['RightLowerArm'] = true,
	['RightHand']     = true,
	['LeftUpperLeg']  = true,
	['LeftLowerLeg']  = true,
	['LeftFoot']      = true,
	['RightUpperLeg'] = true,
	['RightLowerLeg'] = true,
	['RightFoot']     = true,
};



local function GetVFXFolder(): (Instance?)
	local AssetsFolder: Instance? = ReplicatedStorage:FindFirstChild('Assets');
	local VFXFolder: Instance? = AssetsFolder and AssetsFolder:FindFirstChild('VFX') or nil;

	return VFXFolder;
end

local function ForceInvisibleVFXPart(TargetPart: BasePart, ShouldAnchor: boolean): ()
	TargetPart.Transparency = 1.0;
	TargetPart.CanCollide = false;
	TargetPart.CanQuery = false;
	TargetPart.CanTouch = false;
	TargetPart.CastShadow = false;
	TargetPart.Massless = true;
	TargetPart.Anchored = ShouldAnchor;

	return;
end

---> Sanitizes all container `BasePart` instances inside `ReplicatedStorage.Assets.VFX` so no visible or collidable root bricks exist.
local function SanitizeVFXTemplates(): ()
	local VFXFolder: Instance? = GetVFXFolder();

	if not VFXFolder then return end

	for _: number, ChildNode: Instance in VFXFolder:GetDescendants() do
		if ChildNode:IsA('BasePart') then
			local InsideAurasFolder: boolean = (ChildNode:FindFirstAncestor('AURAS') ~= nil);

			ChildNode.CanCollide = false;
			ChildNode.CanQuery = false;
			ChildNode.CanTouch = false;
			ChildNode.CastShadow = false;
			ChildNode.Massless = true;

			if not InsideAurasFolder then
				ChildNode.Transparency = 1.0;
			end
		end
	end

	return;
end

local function SampleFloorMaterialAndColor(OriginPosition: Vector3, IgnoreCharacter: Model?): (Enum.Material, Color3, Vector3)
	local RayParams: RaycastParams = RaycastParams.new();
	RayParams.FilterType = (Enum.RaycastFilterType.Exclude);

	local ExcludeList: { [number?]: Instance } = { };
	local LiveFolder: Instance? = WS:FindFirstChild('Live');

	if LiveFolder then
		table.insert(ExcludeList, LiveFolder);
	end

	if IgnoreCharacter then
		table.insert(ExcludeList, IgnoreCharacter);
	end

	RayParams.FilterDescendantsInstances = ExcludeList;

	local DownRayResult: RaycastResult? = WS:Raycast(OriginPosition, Vector3.new(0.0, -18.0, 0.0), RayParams);

	if DownRayResult and (DownRayResult.Instance) and (DownRayResult.Instance):IsA('BasePart') then
		local HitPart: BasePart = (DownRayResult.Instance :: BasePart);

		return (DownRayResult.Material), (HitPart.Color), (DownRayResult.Position);
	end

	return (Enum.Material.Slate), Color3.fromRGB(78, 82, 92), (OriginPosition - Vector3.new(0.0, 3.0, 0.0));
end

local function TriggerDescendantFX(Container: Instance, FallbackEmitCount: number, EffectDuration: number): ()
	local AllNodes: { [number?]: Instance } = Container:GetDescendants();
	table.insert(AllNodes, Container);

	for _: number?, NodeObject: Instance in AllNodes do
		if NodeObject:IsA('BasePart') then
			NodeObject.Transparency = 1.0;
			NodeObject.CanCollide = false;
			NodeObject.CanQuery = false;
			NodeObject.CanTouch = false;
			NodeObject.CastShadow = false;
			NodeObject.Massless = true;
		elseif NodeObject:IsA('ParticleEmitter') then
			local DelayAttr: number? = (NodeObject:GetAttribute('EmitDelay') :: number?);
			local CountAttr: number? = (NodeObject:GetAttribute('EmitCount') :: number?);
			local DurationAttr: number? = (NodeObject:GetAttribute('EmitDuration') :: number?);

			local EmitDelay: number = DelayAttr or 0.0;
			local EmitCount: number = CountAttr or 0;
			local EmitDuration: number = DurationAttr or 0.0;

			local function FireEmitterLogic(): ()
				if not (NodeObject.Parent) then return end

				if (EmitDuration > 0.0) then
					NodeObject.Enabled = true;

					task.delay(EmitDuration, function(): ()
						if (NodeObject.Parent) then
							NodeObject.Enabled = false;
						end

						return;
					end);
				elseif (EmitCount > 0) then
					NodeObject.Enabled = false;
					NodeObject:Emit(EmitCount);
				else
					local DerivedCount: number = FallbackEmitCount;

					if ((NodeObject.Rate) > 0) then
						DerivedCount = math.clamp(math.floor(((NodeObject.Rate) * 0.22)), 6, 32);
					end

					NodeObject.Enabled = false;
					NodeObject:Emit(DerivedCount);
				end

				return;
			end

			if (EmitDelay > 0.0) then
				NodeObject.Enabled = false;
				task.delay(EmitDelay, FireEmitterLogic);
			else
				FireEmitterLogic();
			end
		elseif NodeObject:IsA('Beam') then
			NodeObject.Enabled = true;
			local FadeInfo: TweenInfo = TweenInfo.new((EffectDuration * 0.85), (Enum.EasingStyle.Quad), (Enum.EasingDirection.Out));
			local BeamTween: Tween = TS:Create(NodeObject, FadeInfo, {
				Width0 = 0.0,
				Width1 = 0.0,
			});
			BeamTween:Play();
		elseif NodeObject:IsA('Trail') then
			NodeObject.Enabled = true;

			task.delay((EffectDuration * 0.8), function(): ()
				if (NodeObject.Parent) then
					NodeObject.Enabled = false;
				end

				return;
			end);
		elseif NodeObject:IsA('PointLight') or NodeObject:IsA('SpotLight') then
			local LightTween: Tween = TS:Create(NodeObject, TweenInfo.new((EffectDuration * 0.85), (Enum.EasingStyle.Quad), (Enum.EasingDirection.Out)), {
				Brightness = 0.0,
				Range      = 0.0,
			});
			LightTween:Play();
		end
	end

	return;
end

---> Clones, sanitizes (`Transparency = 1`, `CanCollide = false`, `Massless = true`), and triggers an unpacked `.rbxm` VFX hierarchy.
local function SpawnUnpackedVFX(TemplateName: string, TargetCFrame: CFrame, AttachToPart: BasePart?, CleanupTime: number?): (Instance?)
	local VFXFolder: Instance? = GetVFXFolder();

	if not VFXFolder then return nil end

	local RawTemplate: Instance? = VFXFolder:FindFirstChild(TemplateName);

	if not RawTemplate then return nil end

	local SourceTemplate: Instance = RawTemplate;

	if RawTemplate:IsA('Folder') then
		local FolderChildren: { [number?]: Instance } = RawTemplate:GetChildren();

		if ((#FolderChildren) > 0) then
			local RandomIndex: number = math.random(1, (#FolderChildren));
			SourceTemplate = (FolderChildren[RandomIndex] :: Instance);
		end
	end

	local ClonedVFX: Instance = SourceTemplate:Clone();
	local ResolvedLifetime: number = CleanupTime or 1.45;
	local ShouldAnchorParts: boolean = (AttachToPart == nil);

	for _: number, SubObject: Instance in ClonedVFX:GetDescendants() do
		if SubObject:IsA('BasePart') then
			ForceInvisibleVFXPart(SubObject, ShouldAnchorParts);
		end
	end

	if ClonedVFX:IsA('BasePart') then
		ForceInvisibleVFXPart(ClonedVFX, ShouldAnchorParts);
		ClonedVFX.CFrame = TargetCFrame;

		if AttachToPart then
			ClonedVFX.Parent = AttachToPart;

			local AttachWeld: WeldConstraint = Instance.new('WeldConstraint');
			AttachWeld.Part0 = AttachToPart;
			AttachWeld.Part1 = ClonedVFX;
			AttachWeld.Parent = ClonedVFX;
		else
			ClonedVFX.Parent = WS;
		end
	elseif ClonedVFX:IsA('Model') then
		ClonedVFX:PivotTo(TargetCFrame);
		ClonedVFX.Parent = WS;
	else
		ClonedVFX.Parent = AttachToPart or WS;
	end

	TriggerDescendantFX(ClonedVFX, 14, ResolvedLifetime);
	D:AddItem(ClonedVFX, ResolvedLifetime);

	return ClonedVFX;
end

local function GraftAuraFromTemplate(Character: Model, AuraVariantName: string, CleanupList: { [number?]: Instance }): ()
	local VFXFolder: Instance? = GetVFXFolder();
	local AurasFolder: Instance? = VFXFolder and VFXFolder:FindFirstChild('AURAS') or nil;

	if not AurasFolder then return end

	local AuraDummy: Instance? = AurasFolder:FindFirstChild(AuraVariantName);

	if not AuraDummy then
		local AllVariants: { [number?]: Instance } = AurasFolder:GetChildren();

		if ((#AllVariants) >= 2) then
			AuraDummy = AllVariants[2];
		elseif ((#AllVariants) >= 1) then
			AuraDummy = AllVariants[1];
		end
	end

	if not AuraDummy then return end

	for TemplateLimbName: string?, CandidateNames: { [number?]: string } in LimbFallbackMap do
		local SafeTemplateLimbName: string = (TemplateLimbName :: string);
		local SourceLimb: Instance? = AuraDummy:FindFirstChild(SafeTemplateLimbName);

		if SourceLimb then
			local TargetLimb: BasePart? = nil;

			for _: number?, CandidateLimbName: string in CandidateNames do
				local FoundLimb: Instance? = Character:FindFirstChild(CandidateLimbName);

				if FoundLimb and FoundLimb:IsA('BasePart') then
					TargetLimb = FoundLimb;
					break;
				end
			end

			if TargetLimb then
				local SafeTargetLimb: BasePart = (TargetLimb :: BasePart);

				for _: number, LimbChild: Instance in SourceLimb:GetChildren() do
					if LimbChild:IsA('ParticleEmitter') or LimbChild:IsA('Attachment') or LimbChild:IsA('PointLight') then
						local ClonedNode: Instance = LimbChild:Clone();

						if ClonedNode:IsA('ParticleEmitter') then
							ClonedNode.Enabled = true;
						end

						for _: number, NestedNode: Instance in ClonedNode:GetDescendants() do
							if NestedNode:IsA('ParticleEmitter') then
								NestedNode.Enabled = true;
							end
						end

						ClonedNode.Parent = SafeTargetLimb;
						table.insert(CleanupList, ClonedNode);
					end
				end
			end
		end
	end

	local RageSpellTemplate: Instance? = VFXFolder and VFXFolder:FindFirstChild('RAGE SPELL') or nil;
	local RootPart: BasePart? = (Character:FindFirstChild('HumanoidRootPart') :: BasePart?);
	local TorsoPart: BasePart? = (Character:FindFirstChild('Torso') :: BasePart?) or (Character:FindFirstChild('UpperTorso') :: BasePart?) or RootPart;

	if RageSpellTemplate and RootPart and TorsoPart then
		for _: number, SpellChild: Instance in RageSpellTemplate:GetChildren() do
			if SpellChild:IsA('Attachment') or SpellChild:IsA('ParticleEmitter') or SpellChild:IsA('PointLight') then
				local ClonedSpellNode: Instance = SpellChild:Clone();
				local TargetHost: BasePart = SpellChild:IsA('Attachment') and RootPart or TorsoPart;

				if ClonedSpellNode:IsA('Attachment') then
					ClonedSpellNode.Position = Vector3.new(0.0, -2.65, 0.0);
				elseif ClonedSpellNode:IsA('ParticleEmitter') then
					local CountAttr: number? = (ClonedSpellNode:GetAttribute('EmitCount') :: number?);

					if (CountAttr ~= nil) and (CountAttr == 0) and ((ClonedSpellNode.Rate) >= 100.0) then
						ClonedSpellNode.Enabled = false;
						ClonedSpellNode:Emit(25);
					else
						ClonedSpellNode.Enabled = true;
					end
				end

				for _: number, SubSpellNode: Instance in ClonedSpellNode:GetDescendants() do
					if SubSpellNode:IsA('ParticleEmitter') then
						SubSpellNode.Enabled = true;
					end
				end

				ClonedSpellNode.Parent = TargetHost;
				table.insert(CleanupList, ClonedSpellNode);
			end
		end
	end

	return;
end

---> Spawns `14-18` varied 3D floor-material debris cubes/slabs in a ring that burst upward and slowly float/rotate in low gravity on Rage activation (`G`).
local function PlayRageGroundShatter(Character: Model): ()
	if not Character then return end

	local RootPart: BasePart? = (Character:FindFirstChild('HumanoidRootPart') :: BasePart?);

	if not RootPart then return end

	local FloorMaterial: Enum.Material, FloorColor: Color3, GroundPoint: Vector3 = SampleFloorMaterialAndColor((RootPart.Position), Character);

	SpawnUnpackedVFX('explosion_os', CFrame.new(GroundPoint), nil, 2.2);

	local DebrisContainer: Folder = Instance.new('Folder');
	DebrisContainer.Name = 'RageFloatingDebrisRing';
	DebrisContainer.Parent = WS;

	local FloatingEntries: { [number?]: FloatingDebrisEntry } = { };
	local TotalDebris: number = math.clamp((CombatTable.RageDebrisCount), 14, 18);
	local InnerRadius: number = (CombatTable.RageDebrisInnerRadius);
	local OuterRadius: number = (CombatTable.RageDebrisOuterRadius);

	for Index: number = 0, (TotalDebris - 1) do
		local AngleRatio: number = (Index / TotalDebris);
		local BaseAngle: number = ((AngleRatio * (math.pi * 2.0)) + (math.random(-12, 12) * 0.01));
		local RadialDist: number = (InnerRadius + ((OuterRadius - InnerRadius) * (((Index % 3) == 0) and 0.38 or (((Index % 3) == 1) and 0.68 or 0.92))));
		local OffsetX: number = (math.cos(BaseAngle) * RadialDist);
		local OffsetZ: number = (math.sin(BaseAngle) * RadialDist);

		local SpawnPos: Vector3 = (GroundPoint + Vector3.new(OffsetX, -0.45, OffsetZ));
		local BurstHeight: number = (1.8 + ((Index % 4) * 0.85));
		local BurstPos: Vector3 = (GroundPoint + Vector3.new((OffsetX * 1.12), BurstHeight, (OffsetZ * 1.12)));

		local CubePart: Part = Instance.new('Part');
		CubePart.Name = `FracturedGroundDebris_{Index}`;
		CubePart.Anchored = true;
		CubePart.CanCollide = false;
		CubePart.CanQuery = false;
		CubePart.CanTouch = false;
		CubePart.Massless = true;
		CubePart.Material = FloorMaterial;
		CubePart.Color = FloorColor;

		local IsSlabPiece: boolean = ((Index % 2) == 0);
		local PieceWidth: number = IsSlabPiece and (1.85 + ((Index % 3) * 0.45)) or (1.15 + ((Index % 3) * 0.35));
		local PieceHeight: number = IsSlabPiece and (0.48 + ((Index % 2) * 0.24)) or (1.10 + ((Index % 2) * 0.45));
		local PieceDepth: number = IsSlabPiece and (1.35 + ((Index % 2) * 0.40)) or PieceWidth;
		CubePart.Size = Vector3.new(PieceWidth, PieceHeight, PieceDepth);

		local InitialOrientation: CFrame = CFrame.Angles(math.rad(math.random(-45, 45)), math.rad(math.random(0, 360)), math.rad(math.random(-45, 45)));
		CubePart.CFrame = (CFrame.new(SpawnPos) * InitialOrientation);
		CubePart.Parent = DebrisContainer;

		local EruptTween: Tween = TS:Create(CubePart, TweenInfo.new(0.24, (Enum.EasingStyle.Back), (Enum.EasingDirection.Out)), {
			CFrame = (CFrame.new(BurstPos) * InitialOrientation),
		});
		EruptTween:Play();

		local SpinSpeed: Vector3 = Vector3.new(math.rad(math.random(-85, 85)), math.rad(math.random(-110, 110)), math.rad(math.random(-85, 85)));
		local PieceRiseSpeed: number = ((CombatTable.RageDebrisRiseSpeed) * (0.72 + ((Index % 4) * 0.16)));

		table.insert(FloatingEntries, {
			CubePart   = CubePart,
			SpinVector = SpinSpeed,
			RiseSpeed  = PieceRiseSpeed,
		});
	end

	task.delay(0.24, function(): ()
		if not (DebrisContainer.Parent) then return end

		local FloatStartClock: number = os.clock();
		local FloatDuration: number = (CombatTable.RageDebrisFloatDuration);
		local FloatConnection: RBXScriptConnection? = nil;

		FloatConnection = RS.Heartbeat:Connect(function(DeltaTime: number): ()
			local Elapsed: number = (os.clock() - FloatStartClock);

			if (Elapsed >= FloatDuration) or not (DebrisContainer.Parent) then
				if FloatConnection then
					FloatConnection:Disconnect();
					FloatConnection = nil;
				end

				for _: number?, EntryItem: FloatingDebrisEntry in FloatingEntries do
					if (EntryItem.CubePart.Parent) then
						local DissolveTween: Tween = TS:Create((EntryItem.CubePart), TweenInfo.new(0.35, (Enum.EasingStyle.Quad), (Enum.EasingDirection.In)), {
							Size         = Vector3.new(0.05, 0.05, 0.05),
							Transparency = 1.0,
						});
						DissolveTween:Play();
					end
				end

				D:AddItem(DebrisContainer, 0.4);

				return;
			end

			local DampingFactor: number = math.clamp((1.0 - ((Elapsed / FloatDuration) * 0.45)), 0.30, 1.0);

			for _: number?, EntryItem: FloatingDebrisEntry in FloatingEntries do
				local ActiveCube: Part = (EntryItem.CubePart);

				if (ActiveCube.Parent) then
					local SpinStep: Vector3 = ((EntryItem.SpinVector) * DeltaTime);
					local VerticalStep: number = (((EntryItem.RiseSpeed) * DampingFactor) * DeltaTime);
					local NextPosition: Vector3 = ((ActiveCube.Position) + Vector3.new(0.0, VerticalStep, 0.0));
					local NextRotation: CFrame = ((ActiveCube.CFrame - (ActiveCube.Position)) * CFrame.Angles((SpinStep.X), (SpinStep.Y), (SpinStep.Z)));

					ActiveCube.CFrame = (CFrame.new(NextPosition) * NextRotation);
				end
			end

			return;
		end);

		return;
	end);

	return;
end

---> Spawns a clean weapon slash crescent or fist knuckle shockwave in front of <Character> (keeping M1 slashes compact and restricting large bursts to Heavy).
local function PlaySlashVFX(Character: Model, WeaponName: string?, IsHeavy: boolean?, ComboStep: number?): ()
	if not Character then return end

	local RootPart: BasePart? = (Character:FindFirstChild('HumanoidRootPart') :: BasePart?);

	if not RootPart then return end

	local HeavyFlag: boolean = (IsHeavy == true);
	local StyleString: string = WeaponName or 'Fists';
	local StepIndex: number = ComboStep or 1;
	local TiltAngle: number = math.rad(math.random(-32, 32));
	local SlashCFrame: CFrame = (((RootPart.CFrame) * CFrame.new(0.0, 0.2, -3.1)) * CFrame.Angles(0.0, 0.0, TiltAngle));

	if HeavyFlag then
		SpawnUnpackedVFX('Attack Fx', SlashCFrame, nil, 0.75);
	end

	if (StyleString == 'Fists') then
		local FistColor: Color3 = HeavyFlag and Color3.fromRGB(255, 195, 65) or Color3.fromRGB(220, 240, 255);
		local UseLeftHand: boolean = (not HeavyFlag) and (StepIndex == 2);
		local HandLimbKey: string = UseLeftHand and 'Left Arm' or 'Right Arm';
		local HandPart: BasePart? = ResolveCharacterLimb(Character, HandLimbKey);
		local LateralOffset: number = UseLeftHand and -0.65 or 0.65;

		if HeavyFlag or (StepIndex == 4) then
			LateralOffset = 0.0;
		end

		local OriginCFrame: CFrame = ((RootPart.CFrame) * CFrame.new(LateralOffset, 0.25, -1.65));

		if HandPart then
			local RootLook: Vector3 = (RootPart.CFrame.LookVector);
			OriginCFrame = CFrame.lookAt((HandPart.Position), ((HandPart.Position) + RootLook));
		end

		if (StepIndex == 4) and not HeavyFlag then
			OriginCFrame = (OriginCFrame * CFrame.Angles(math.rad(52.0), 0.0, 0.0));
		elseif (StepIndex == 3) and not HeavyFlag then
			OriginCFrame = (OriginCFrame * CFrame.Angles(0.0, math.rad(18.0), 0.0));
		end

		local ShockRingPart: Part = Instance.new('Part');
		ShockRingPart.Name = 'FistKnuckleShockRing';
		ShockRingPart.Shape = (Enum.PartType.Cylinder);
		ShockRingPart.Anchored = true;
		ShockRingPart.CanCollide = false;
		ShockRingPart.CanQuery = false;
		ShockRingPart.CanTouch = false;
		ShockRingPart.CastShadow = false;
		ShockRingPart.Massless = true;
		ShockRingPart.Material = (Enum.Material.Neon);
		ShockRingPart.Color = FistColor;
		ShockRingPart.Transparency = 0.15;
		ShockRingPart.Size = HeavyFlag and Vector3.new(0.24, 2.2, 2.2) or Vector3.new(0.16, 1.35, 1.35);
		ShockRingPart.CFrame = ((OriginCFrame * CFrame.new(0.0, 0.0, -0.85)) * CFrame.Angles(0.0, math.rad(90.0), 0.0));
		ShockRingPart.Parent = WS;

		local RingTargetSize: Vector3 = HeavyFlag and Vector3.new(0.08, 4.8, 4.8) or Vector3.new(0.06, 2.95, 2.95);
		local RingEndCFrame: CFrame = ((OriginCFrame * CFrame.new(0.0, 0.0, -3.15)) * CFrame.Angles(0.0, math.rad(90.0), 0.0));
		local RingTween: Tween = TS:Create(ShockRingPart, TweenInfo.new(0.16, (Enum.EasingStyle.Quad), (Enum.EasingDirection.Out)), {
			Size         = RingTargetSize,
			Transparency = 1.0,
			CFrame       = RingEndCFrame,
		});
		RingTween:Play();
		D:AddItem(ShockRingPart, 0.20);

		local StreakPart: Part = Instance.new('Part');
		StreakPart.Name = 'FistPunchStreak';
		StreakPart.Anchored = true;
		StreakPart.CanCollide = false;
		StreakPart.CanQuery = false;
		StreakPart.CanTouch = false;
		StreakPart.CastShadow = false;
		StreakPart.Massless = true;
		StreakPart.Material = (Enum.Material.Neon);
		StreakPart.Color = Color3.fromRGB(255, 255, 255);
		StreakPart.Transparency = 0.12;
		StreakPart.Size = HeavyFlag and Vector3.new(0.55, 0.55, 2.8) or Vector3.new(0.32, 0.32, 2.1);
		StreakPart.CFrame = (OriginCFrame * CFrame.new(0.0, 0.0, -1.25));
		StreakPart.Parent = WS;

		local StreakMesh: SpecialMesh = Instance.new('SpecialMesh');
		StreakMesh.MeshType = (Enum.MeshType.Sphere);
		StreakMesh.Parent = StreakPart;

		local StreakTween: Tween = TS:Create(StreakPart, TweenInfo.new(0.15, (Enum.EasingStyle.Quad), (Enum.EasingDirection.Out)), {
			Size         = HeavyFlag and Vector3.new(0.12, 0.12, 4.8) or Vector3.new(0.08, 0.08, 3.6),
			Transparency = 1.0,
			CFrame       = (OriginCFrame * CFrame.new(0.0, 0.0, -3.4)),
		});
		StreakTween:Play();
		D:AddItem(StreakPart, 0.18);

		return;
	end

	local ArcColor: Color3 = HeavyFlag and Color3.fromRGB(255, 195, 65) or Color3.fromRGB(155, 215, 255);

	if (StyleString == 'Katana') then
		ArcColor = Color3.fromRGB(255, 85, 130);
	elseif (StyleString == 'Spear') then
		ArcColor = Color3.fromRGB(90, 235, 165);
	elseif (StyleString == 'Bow') then
		ArcColor = Color3.fromRGB(190, 135, 255);
	end

	local SlashArcPart: Part = Instance.new('Part');
	SlashArcPart.Name = 'ProceduralSlashCrescent';
	SlashArcPart.Anchored = true;
	SlashArcPart.CanCollide = false;
	SlashArcPart.CanQuery = false;
	SlashArcPart.CanTouch = false;
	SlashArcPart.CastShadow = false;
	SlashArcPart.Massless = true;
	SlashArcPart.Material = (Enum.Material.Neon);
	SlashArcPart.Color = ArcColor;
	SlashArcPart.Transparency = 0.18;
	SlashArcPart.Size = HeavyFlag and Vector3.new(4.8, 0.18, 3.2) or Vector3.new(3.0, 0.12, 2.0);
	SlashArcPart.CFrame = SlashCFrame;
	SlashArcPart.Parent = WS;

	local CrescentMesh: SpecialMesh = Instance.new('SpecialMesh');
	CrescentMesh.MeshType = (Enum.MeshType.Sphere);
	CrescentMesh.Parent = SlashArcPart;

	local ArcTweenInfo: TweenInfo = TweenInfo.new(0.18, (Enum.EasingStyle.Quad), (Enum.EasingDirection.Out));
	local ArcTween: Tween = TS:Create(SlashArcPart, ArcTweenInfo, {
		Size         = HeavyFlag and Vector3.new(6.2, 0.08, 4.2) or Vector3.new(3.8, 0.06, 2.6),
		Transparency = 1.0,
		CFrame       = (SlashCFrame * CFrame.new(0.0, 0.0, -1.2)),
	});
	ArcTween:Play();

	D:AddItem(SlashArcPart, 0.22);

	return;
end

---> Spawns compact `2-4 stud` impact sparks and slash crescents on basic M1 hits, and `LIGHTNING_EXPLOSION` on Heavy / Parry / GuardBreak / Vanish.
local function PlayHitVFX(TargetInstance: Instance, IsHeavy: boolean?, HitKind: string?): ()
	if not TargetInstance then return end

	local TargetRoot: BasePart? = nil;

	if TargetInstance:IsA('Model') then
		TargetRoot = (TargetInstance:FindFirstChild('HumanoidRootPart') :: BasePart?) or (TargetInstance.PrimaryPart);
	elseif TargetInstance:IsA('BasePart') then
		TargetRoot = TargetInstance;
	end

	if not TargetRoot then return end

	local SafeRoot: BasePart = (TargetRoot :: BasePart);
	local ResolvedKind: string = HitKind or 'Hit';
	local HeavyFlag: boolean = (IsHeavy == true);

	local FlashColor: Color3 = HeavyFlag and Color3.fromRGB(255, 195, 65) or Color3.fromRGB(255, 135, 95);

	if (ResolvedKind == 'Parry') then
		FlashColor = Color3.fromRGB(80, 235, 255);
	elseif (ResolvedKind == 'Block') then
		FlashColor = Color3.fromRGB(110, 170, 255);
	elseif (ResolvedKind == 'GuardBreak') then
		FlashColor = Color3.fromRGB(255, 45, 65);
	elseif (ResolvedKind == 'Vanish') then
		FlashColor = Color3.fromRGB(195, 95, 255);
	end

	if HeavyFlag or (ResolvedKind == 'Parry') or (ResolvedKind == 'GuardBreak') or (ResolvedKind == 'Vanish') then
		SpawnUnpackedVFX('LIGHTNING_EXPLOSION', (SafeRoot.CFrame), nil, 1.55);
	else
		local SparkContainer: Part = Instance.new('Part');
		ForceInvisibleVFXPart(SparkContainer, true);
		SparkContainer.Name = 'M1CompactHitSparks';
		SparkContainer.Size = Vector3.new(0.25, 0.25, 0.25);
		SparkContainer.CFrame = (SafeRoot.CFrame);
		SparkContainer.Parent = WS;

		local SparkAttachment: Attachment = Instance.new('Attachment');
		SparkAttachment.Parent = SparkContainer;

		local SparkEmitter: ParticleEmitter = Instance.new('ParticleEmitter');
		SparkEmitter.Color = ColorSequence.new(Color3.fromRGB(255, 245, 195), FlashColor);
		SparkEmitter.LightEmission = 1.0;
		SparkEmitter.Size = NumberSequence.new({
			NumberSequenceKeypoint.new(0.0, 0.28),
			NumberSequenceKeypoint.new(1.0, 0.0),
		});
		SparkEmitter.Transparency = NumberSequence.new({
			NumberSequenceKeypoint.new(0.0, 0.0),
			NumberSequenceKeypoint.new(1.0, 1.0),
		});
		SparkEmitter.Lifetime = NumberRange.new(0.11, 0.20);
		SparkEmitter.Speed = NumberRange.new(10.0, 18.0);
		SparkEmitter.SpreadAngle = Vector2.new(180.0, 180.0);
		SparkEmitter.Drag = 6.5;
		SparkEmitter.Rate = 0;
		SparkEmitter.Parent = SparkAttachment;

		SparkEmitter:Emit(14);
		D:AddItem(SparkContainer, 0.32);
	end

	if TargetInstance:IsA('Model') then
		local ImpactHighlight: Highlight = Instance.new('Highlight');
		ImpactHighlight.Name = 'CombatImpactHighlight';
		ImpactHighlight.Adornee = TargetInstance;
		ImpactHighlight.FillColor = FlashColor;
		ImpactHighlight.OutlineColor = Color3.fromRGB(255, 255, 255);
		ImpactHighlight.FillTransparency = 0.42;
		ImpactHighlight.OutlineTransparency = 0.12;
		ImpactHighlight.Parent = TargetInstance;

		local HighlightTween: Tween = TS:Create(ImpactHighlight, TweenInfo.new(0.20, (Enum.EasingStyle.Quad), (Enum.EasingDirection.Out)), {
			FillTransparency    = 1.0,
			OutlineTransparency = 1.0,
		});
		HighlightTween:Play();
		D:AddItem(ImpactHighlight, 0.22);
	end

	local SlashCrescent: Part = Instance.new('Part');
	SlashCrescent.Name = 'ImpactSlashCrescent';
	SlashCrescent.Anchored = true;
	SlashCrescent.CanCollide = false;
	SlashCrescent.CanQuery = false;
	SlashCrescent.CanTouch = false;
	SlashCrescent.CastShadow = false;
	SlashCrescent.Massless = true;
	SlashCrescent.Material = (Enum.Material.Neon);
	SlashCrescent.Color = FlashColor;
	SlashCrescent.Transparency = 0.15;
	SlashCrescent.Size = Vector3.new(1.2, 0.15, 1.2);
	SlashCrescent.CFrame = ((SafeRoot.CFrame) * CFrame.Angles(math.rad(math.random(-65, 65)), math.rad(math.random(0, 360)), math.rad(math.random(-65, 65))));
	SlashCrescent.Parent = WS;

	local CrescentMesh: SpecialMesh = Instance.new('SpecialMesh');
	CrescentMesh.MeshType = (Enum.MeshType.Sphere);
	CrescentMesh.Parent = SlashCrescent;

	local TargetSpan: number = ((ResolvedKind == 'GuardBreak') or (ResolvedKind == 'Parry') or (ResolvedKind == 'Vanish') or HeavyFlag) and 5.6 or 3.2;
	local RingTween: Tween = TS:Create(SlashCrescent, TweenInfo.new(0.18, (Enum.EasingStyle.Quint), (Enum.EasingDirection.Out)), {
		Size         = Vector3.new(TargetSpan, 0.06, TargetSpan),
		Transparency = 1.0,
	});
	RingTween:Play();
	D:AddItem(SlashCrescent, 0.20);

	return;
end

---> Spawns a radial explosion shockwave (`explosion_os` strictly on Aerial Plunge Slam, plus 3D floor debris).
local function PlayExplosionShockwave(OriginPosition: Vector3, Radius: number, CustomColor: Color3?, TriggerExplosionOS: boolean?): ()
	local ShockColor: Color3 = CustomColor or Color3.fromRGB(255, 155, 55);
	local ImpactCFrame: CFrame = CFrame.new(OriginPosition);
	local ShouldUseExplosionOS: boolean = (TriggerExplosionOS ~= false);

	if ShouldUseExplosionOS then
		SpawnUnpackedVFX('explosion_os', ImpactCFrame, nil, 2.2);
	end

	SpawnUnpackedVFX('LIGHTNING_EXPLOSION', ImpactCFrame, nil, 1.9);

	local FloorMaterial: Enum.Material, FloorColor: Color3, GroundPoint: Vector3 = SampleFloorMaterialAndColor((OriginPosition + Vector3.new(0.0, 3.0, 0.0)), nil);

	for Index: number = 0, 9 do
		local Angle: number = ((Index / 10.0) * (math.pi * 2.0));
		local RimRadius: number = (Radius * 0.65);
		local DebrisPos: Vector3 = (GroundPoint + Vector3.new((math.cos(Angle) * RimRadius), 0.35, (math.sin(Angle) * RimRadius)));

		local SlabPart: Part = Instance.new('Part');
		SlabPart.Name = 'SlamCraterSlab';
		SlabPart.Anchored = true;
		SlabPart.CanCollide = false;
		SlabPart.CanQuery = false;
		SlabPart.CanTouch = false;
		SlabPart.Massless = true;
		SlabPart.Material = FloorMaterial;
		SlabPart.Color = FloorColor;
		SlabPart.Size = Vector3.new(1.8, 0.85, 1.4);
		SlabPart.CFrame = (CFrame.lookAt(DebrisPos, GroundPoint) * CFrame.Angles(math.rad(-28), 0.0, 0.0));
		SlabPart.Parent = WS;

		local SlabTween: Tween = TS:Create(SlabPart, TweenInfo.new(0.75, (Enum.EasingStyle.Quad), (Enum.EasingDirection.In)), {
			Position     = (DebrisPos - Vector3.new(0.0, 1.1, 0.0)),
			Transparency = 1.0,
		});
		SlabTween:Play();
		D:AddItem(SlabPart, 0.8);
	end

	local DomePart: Part = Instance.new('Part');
	DomePart.Name = 'ShockwaveDome';
	DomePart.Shape = (Enum.PartType.Ball);
	DomePart.Material = (Enum.Material.Neon);
	DomePart.Color = ShockColor;
	DomePart.Anchored = true;
	DomePart.CanCollide = false;
	DomePart.CanQuery = false;
	DomePart.CanTouch = false;
	DomePart.Massless = true;
	DomePart.Transparency = 0.25;
	DomePart.Size = Vector3.new(2.0, 1.0, 2.0);
	DomePart.Position = OriginPosition;
	DomePart.Parent = WS;

	local Diameter: number = (Radius * 1.6);
	local DomeTween: Tween = TS:Create(DomePart, TweenInfo.new(0.36, (Enum.EasingStyle.Quart), (Enum.EasingDirection.Out)), {
		Size         = Vector3.new(Diameter, (Radius * 0.55), Diameter),
		Transparency = 1.0,
	});
	DomeTween:Play();
	D:AddItem(DomePart, 0.38);

	return;
end

---> Clones each visible character limb (`Head`, `Torso`, arms, legs, and `SpecialMesh`/`CharacterMesh`) at its exact world `CFrame` for afterimages.
local function SpawnCharacterSilhouette(Character: Model, SilhouetteColor: Color3, OptionalOriginRootCFrame: CFrame?): (Model?)
	if not Character then return nil end

	local RootPart: BasePart? = (Character:FindFirstChild('HumanoidRootPart') :: BasePart?);

	if not RootPart then return nil end

	local CurrentRootCFrame: CFrame = (RootPart.CFrame);
	local ReferenceRootCFrame: CFrame = OptionalOriginRootCFrame or CurrentRootCFrame;
	local PreviousArchivable: boolean = (Character.Archivable);
	Character.Archivable = true;

	local SilhouetteModel: Model = Instance.new('Model');
	SilhouetteModel.Name = 'CharacterAfterimageSilhouette';

	for _: number, ChildObj: Instance in Character:GetChildren() do
		if ChildObj:IsA('BasePart') and CanonicalCharacterLimbs[ChildObj.Name] and ((ChildObj.Transparency) < 0.95) then
			local ClonedLimb: BasePart = (ChildObj:Clone() :: BasePart);

			for _: number, LimbDescendant: Instance in ClonedLimb:GetChildren() do
				if not LimbDescendant:IsA('DataModelMesh') and not LimbDescendant:IsA('CharacterMesh') then
					LimbDescendant:Destroy();
				end
			end

			local RelativeLimbCFrame: CFrame = CurrentRootCFrame:ToObjectSpace((ChildObj.CFrame));
			ClonedLimb.CFrame = (ReferenceRootCFrame * RelativeLimbCFrame);
			ClonedLimb.Anchored = true;
			ClonedLimb.CanCollide = false;
			ClonedLimb.CanQuery = false;
			ClonedLimb.CanTouch = false;
			ClonedLimb.CastShadow = false;
			ClonedLimb.Massless = true;
			ClonedLimb.Material = (Enum.Material.Neon);
			ClonedLimb.Color = SilhouetteColor;
			ClonedLimb.Transparency = 0.45;
			ClonedLimb.Parent = SilhouetteModel;

			local FadeTween: Tween = TS:Create(ClonedLimb, TweenInfo.new(0.35, (Enum.EasingStyle.Quad), (Enum.EasingDirection.Out)), {
				Transparency = 1.0,
			});
			FadeTween:Play();
		elseif ChildObj:IsA('CharacterMesh') then
			local ClonedCharMesh: CharacterMesh = (ChildObj:Clone() :: CharacterMesh);
			ClonedCharMesh.Parent = SilhouetteModel;
		end
	end

	Character.Archivable = PreviousArchivable;
	SilhouetteModel.Parent = WS;
	D:AddItem(SilhouetteModel, 0.38);

	return SilhouetteModel;
end

---> Spawns a Flash-Step / Vanish limb-accurate silhouette afterimage, warp beam, and `LIGHTNING_EXPLOSION` arrival burst.
local function PlayVanishVFX(Attacker: Model, OriginPosition: Vector3, DestinationPosition: Vector3): ()
	local RootPart: BasePart? = (Attacker:FindFirstChild('HumanoidRootPart') :: BasePart?);
	local OriginCFrame: CFrame = RootPart and ((RootPart.CFrame - (RootPart.Position)) + OriginPosition) or CFrame.new(OriginPosition);

	SpawnCharacterSilhouette(Attacker, Color3.fromRGB(175, 95, 255), OriginCFrame);

	local WarpDelta: Vector3 = (DestinationPosition - OriginPosition);
	local WarpDistance: number = (WarpDelta.Magnitude);

	if (WarpDistance > 0.5) then
		local MidPoint: Vector3 = ((OriginPosition + DestinationPosition) * 0.5);
		local StreakBeamPart: Part = Instance.new('Part');
		StreakBeamPart.Name = 'VanishWarpStreak';
		StreakBeamPart.Anchored = true;
		StreakBeamPart.CanCollide = false;
		StreakBeamPart.CanQuery = false;
		StreakBeamPart.CanTouch = false;
		StreakBeamPart.CastShadow = false;
		StreakBeamPart.Massless = true;
		StreakBeamPart.Material = (Enum.Material.Neon);
		StreakBeamPart.Color = Color3.fromRGB(190, 115, 255);
		StreakBeamPart.Transparency = 0.15;
		StreakBeamPart.Size = Vector3.new(0.75, 0.75, WarpDistance);
		StreakBeamPart.CFrame = CFrame.lookAt(MidPoint, DestinationPosition);
		StreakBeamPart.Parent = WS;

		local StreakTween: Tween = TS:Create(StreakBeamPart, TweenInfo.new(0.24, (Enum.EasingStyle.Quart), (Enum.EasingDirection.Out)), {
			Size         = Vector3.new(0.05, 0.05, WarpDistance),
			Transparency = 1.0,
		});
		StreakTween:Play();
		D:AddItem(StreakBeamPart, 0.26);
	end

	SpawnUnpackedVFX('LIGHTNING_EXPLOSION', CFrame.new(DestinationPosition), nil, 1.5);

	return;
end

---> Attaches or removes the persistent Rage Awakening aura (`AURAS.RedAura` + `RAGE SPELL` emitters on `HumanoidRootPart`, `Torso`, and limbs) on <Character>.
local function SetRageAuraActive(Character: Model, IsActive: boolean): ()
	if not Character then return end

	local RootPart: BasePart? = (Character:FindFirstChild('HumanoidRootPart') :: BasePart?);

	if not RootPart then return end

	local ExistingAuraFolder: Instance? = Character:FindFirstChild('ActiveRageAuraContainer');

	if not IsActive then
		if ExistingAuraFolder then
			ExistingAuraFolder:Destroy();
		end

		return;
	end

	if ExistingAuraFolder then
		return;
	end

	local AuraContainer: Folder = Instance.new('Folder');
	AuraContainer.Name = 'ActiveRageAuraContainer';
	AuraContainer.Parent = Character;

	local GraftedNodes: { [number?]: Instance } = { };
	GraftAuraFromTemplate(Character, 'RedAura', GraftedNodes);

	local RageHighlight: Highlight = Instance.new('Highlight');
	RageHighlight.Name = 'RageAwakeningHighlight';
	RageHighlight.Adornee = Character;
	RageHighlight.FillColor = Color3.fromRGB(255, 65, 95);
	RageHighlight.OutlineColor = Color3.fromRGB(255, 215, 85);
	RageHighlight.FillTransparency = 0.72;
	RageHighlight.OutlineTransparency = 0.15;
	RageHighlight.Parent = AuraContainer;

	AuraContainer.Destroying:Connect(function(): ()
		for _: number?, GraftedItem: Instance in GraftedNodes do
			if (GraftedItem.Parent) then
				GraftedItem:Destroy();
			end
		end

		return;
	end);

	PlayRageGroundShatter(Character);

	return;
end

---> Spawns a true limb-and-mesh character silhouette afterimage (`Transparency = 0.45` -> `1.0` over `0.35s`) + `trail` wake during Dash I-Frames.
local function SpawnDashAfterimage(Character: Model, _: Vector3?): ()
	if not Character then return end

	local RootPart: BasePart? = (Character:FindFirstChild('HumanoidRootPart') :: BasePart?);

	if not RootPart then return end

	SpawnUnpackedVFX('trail', (RootPart.CFrame), RootPart, 0.38);
	SpawnCharacterSilhouette(Character, Color3.fromRGB(95, 195, 255), nil);

	return;
end

---> Spawns a burst of dust particles at <Position> when Wall-Climbing or Wall-Running.
local function SpawnWallDust(Position: Vector3, NormalVector: Vector3): ()
	local DustPart: Part = Instance.new('Part');
	ForceInvisibleVFXPart(DustPart, true);
	DustPart.Name = 'WallTraversalDust';
	DustPart.Size = Vector3.new(0.4, 0.4, 0.4);
	DustPart.CFrame = CFrame.lookAt(Position, (Position + NormalVector));
	DustPart.Parent = WS;

	local DustEmitter: ParticleEmitter = Instance.new('ParticleEmitter');
	DustEmitter.Color = ColorSequence.new(Color3.fromRGB(205, 200, 190));
	DustEmitter.Size = NumberSequence.new(0.6, 1.8);
	DustEmitter.Transparency = NumberSequence.new(0.35, 1.0);
	DustEmitter.Lifetime = NumberRange.new(0.25, 0.45);
	DustEmitter.Speed = NumberRange.new(3.0, 7.0);
	DustEmitter.SpreadAngle = Vector2.new(45.0, 45.0);
	DustEmitter.Rate = 0;
	DustEmitter.Parent = DustPart;

	DustEmitter:Emit(6);
	D:AddItem(DustPart, 0.55);

	return;
end

---> Attaches or removes wind stream trails on <Character>'s arms while Gliding.
local function ManageGliderTrail(Character: Model, IsGliding: boolean): ()
	if not Character then return end

	local ExistingFolder: Instance? = Character:FindFirstChild('ActiveGliderTrails');

	if ExistingFolder then
		ExistingFolder:Destroy();
	end

	if not IsGliding then return end

	local TrailContainer: Folder = Instance.new('Folder');
	TrailContainer.Name = 'ActiveGliderTrails';
	TrailContainer.Parent = Character;

	local LimbNames: { [number?]: string } = {
		[1] = 'Left Arm',
		[2] = 'Right Arm',
		[3] = 'LeftHand',
		[4] = 'RightHand',
	};

	for _: number?, LimbKey: string in LimbNames do
		local LimbPart: BasePart? = (Character:FindFirstChild(LimbKey) :: BasePart?);

		if LimbPart then
			local Attachment0: Attachment = Instance.new('Attachment');
			Attachment0.Position = Vector3.new(0, -0.4, 0);
			Attachment0.Parent = LimbPart;

			local Attachment1: Attachment = Instance.new('Attachment');
			Attachment1.Position = Vector3.new(0, 0.4, 0);
			Attachment1.Parent = LimbPart;

			local WindTrail: Trail = Instance.new('Trail');
			WindTrail.Attachment0 = Attachment0;
			WindTrail.Attachment1 = Attachment1;
			WindTrail.Lifetime = 0.35;
			WindTrail.Transparency = NumberSequence.new(0.35, 1.0);
			WindTrail.Color = ColorSequence.new(Color3.fromRGB(195, 235, 255));
			WindTrail.Parent = TrailContainer;

			TrailContainer.Destroying:Connect(function(): ()
				if (Attachment0.Parent) then
					Attachment0:Destroy();
				end

				if (Attachment1.Parent) then
					Attachment1:Destroy();
				end

				return;
			end);
		end
	end

	return;
end



SanitizeVFXTemplates();

local MovementVFX: MovementVFXModule = {
	SanitizeVFXTemplates   = SanitizeVFXTemplates,
	SpawnUnpackedVFX       = SpawnUnpackedVFX,
	PlaySlashVFX           = PlaySlashVFX,
	PlayHitVFX             = PlayHitVFX,
	PlayExplosionShockwave = PlayExplosionShockwave,
	PlayRageGroundShatter  = PlayRageGroundShatter,
	PlayVanishVFX          = PlayVanishVFX,
	SetRageAuraActive      = SetRageAuraActive,
	SpawnDashAfterimage    = SpawnDashAfterimage,
	SpawnWallDust          = SpawnWallDust,
	ManageGliderTrail      = ManageGliderTrail,
};



return MovementVFX;
