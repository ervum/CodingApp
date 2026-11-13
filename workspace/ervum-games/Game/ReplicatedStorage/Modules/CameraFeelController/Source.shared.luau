--!strict

local Lighting: Lighting = game:GetService('Lighting');
local Players: Players = game:GetService('Players');
local ReplicatedStorage: ReplicatedStorage = game:GetService('ReplicatedStorage');
local RS: RunService = game:GetService('RunService');
local TS: TweenService = game:GetService('TweenService');
local WS: Workspace = game:GetService('Workspace');

local ModulesFolder: Instance = ReplicatedStorage:WaitForChild('Modules');
local CombatTable = require(ModulesFolder:WaitForChild('CombatTable') :: ModuleScript);
local StateHandler = require(ModulesFolder:WaitForChild('StateHandler') :: ModuleScript);



type BezierSplineState = {
	StartTime: number,
	Duration:  number,
	Point0:    Vector3,
	Point1:    Vector3,
	Point2:    Vector3,
	Point3:    Vector3,
	RollPeak:  number,
};

export type CameraFeelControllerModule = {
	AddTrauma:           ((number) -> ()),
	PunchFOV:            ((number, number) -> ()),
	SetFOVState:         ((string) -> ()),
	PlayBezierSpline:    ((string) -> ()),
	TriggerImpactFrames: ((string?) -> ()),
	PulseBlur:           ((number, number) -> ()),
	ToggleLockOn:        (() -> (Model?)),
	GetLockedTarget:     (() -> (Model?)),
	ClearLockOn:         (() -> ()),
};



local LocalPlayer: Player = Players.LocalPlayer;
local CurrentTrauma: number = 0.0;
local LockedTargetModel: Model? = nil;
local ActiveReticleBillboard: BillboardGui? = nil;
local ReticleHealthFill: Frame? = nil;
local ReticlePostureFill: Frame? = nil;
local ReticleNameLabel: TextLabel? = nil;

local ActiveSpline: BezierSplineState? = nil;
local SpringPositionOffset: Vector3 = Vector3.zero;
local SpringRollAngle: number = 0.0;
local CurrentSpringFOV: number = (CombatTable.BaseCameraFOV);
local DesiredBaseFOV: number = (CombatTable.BaseCameraFOV);
local ActiveFOVOverride: number? = nil;
local ImpactFrameToken: number = 0;

local ColorCorrectionFX: ColorCorrectionEffect? = nil;
local MotionBlurFX: BlurEffect? = nil;
local BloomFX: BloomEffect? = nil;
local DepthOfFieldFX: DepthOfFieldEffect? = nil;



local function EnsurePostProcessingEffects(): (ColorCorrectionEffect, BlurEffect, BloomEffect, DepthOfFieldEffect)
	if not ColorCorrectionFX or not (ColorCorrectionFX.Parent) then
		local ExistingCC: Instance? = Lighting:FindFirstChild('CombatColorCorrection');

		if ExistingCC and ExistingCC:IsA('ColorCorrectionEffect') then
			ColorCorrectionFX = ExistingCC;
		else
			local NewCC: ColorCorrectionEffect = Instance.new('ColorCorrectionEffect');
			NewCC.Name = 'CombatColorCorrection';
			NewCC.Brightness = 0.0;
			NewCC.Contrast = 0.0;
			NewCC.Saturation = 0.0;
			NewCC.TintColor = Color3.fromRGB(255, 255, 255);
			NewCC.Parent = Lighting;
			ColorCorrectionFX = NewCC;
		end
	end

	if not MotionBlurFX or not (MotionBlurFX.Parent) then
		local ExistingBlur: Instance? = Lighting:FindFirstChild('CombatMotionBlur');

		if ExistingBlur and ExistingBlur:IsA('BlurEffect') then
			MotionBlurFX = ExistingBlur;
		else
			local NewBlur: BlurEffect = Instance.new('BlurEffect');
			NewBlur.Name = 'CombatMotionBlur';
			NewBlur.Size = 0.0;
			NewBlur.Parent = Lighting;
			MotionBlurFX = NewBlur;
		end
	end

	if not BloomFX or not (BloomFX.Parent) then
		local ExistingBloom: Instance? = Lighting:FindFirstChild('CombatBloom');

		if ExistingBloom and ExistingBloom:IsA('BloomEffect') then
			BloomFX = ExistingBloom;
		else
			local NewBloom: BloomEffect = Instance.new('BloomEffect');
			NewBloom.Name = 'CombatBloom';
			NewBloom.Intensity = 0.4;
			NewBloom.Size = 24.0;
			NewBloom.Threshold = 0.92;
			NewBloom.Parent = Lighting;
			BloomFX = NewBloom;
		end
	end

	if not DepthOfFieldFX or not (DepthOfFieldFX.Parent) then
		local ExistingDoF: Instance? = Lighting:FindFirstChild('CombatDepthOfField');

		if ExistingDoF and ExistingDoF:IsA('DepthOfFieldEffect') then
			DepthOfFieldFX = ExistingDoF;
		else
			local NewDoF: DepthOfFieldEffect = Instance.new('DepthOfFieldEffect');
			NewDoF.Name = 'CombatDepthOfField';
			NewDoF.FarIntensity = 0.0;
			NewDoF.NearIntensity = 0.0;
			NewDoF.FocusDistance = 18.0;
			NewDoF.InFocusRadius = 22.0;
			NewDoF.Parent = Lighting;
			DepthOfFieldFX = NewDoF;
		end
	end

	return (ColorCorrectionFX :: ColorCorrectionEffect), (MotionBlurFX :: BlurEffect), (BloomFX :: BloomEffect), (DepthOfFieldFX :: DepthOfFieldEffect);
end

---> Evaluates Cubic Bezier curve $B(t) = (1-t)^3 P_0 + 3(1-t)^2 t P_1 + 3(1-t) t^2 P_2 + t^3 P_3$.
local function EvaluateCubicBezier(Point0: Vector3, Point1: Vector3, Point2: Vector3, Point3: Vector3, Alpha: number): (Vector3)
	local ClampedAlpha: number = math.clamp(Alpha, 0.0, 1.0);
	local InverseAlpha: number = (1.0 - ClampedAlpha);
	local InverseSquared: number = (InverseAlpha * InverseAlpha);
	local InverseCubed: number = (InverseSquared * InverseAlpha);
	local AlphaSquared: number = (ClampedAlpha * ClampedAlpha);
	local AlphaCubed: number = (AlphaSquared * ClampedAlpha);

	local Term0: Vector3 = (Point0 * InverseCubed);
	local Term1: Vector3 = (Point1 * ((3.0 * InverseSquared) * ClampedAlpha));
	local Term2: Vector3 = (Point2 * ((3.0 * InverseAlpha) * AlphaSquared));
	local Term3: Vector3 = (Point3 * AlphaCubed);

	return (((Term0 + Term1) + Term2) + Term3);
end

local function SetTargetHeaderVisibility(TargetModel: Model?, IsVisible: boolean): ()
	if not TargetModel then return end

	for _: number, DescendantObj: Instance in TargetModel:GetDescendants() do
		if DescendantObj:IsA('BillboardGui') and (DescendantObj.Name == 'NPCHeaderBillboard') then
			DescendantObj.Enabled = IsVisible;
		end
	end

	return;
end

local function DestroyReticleUI(): ()
	if LockedTargetModel then
		SetTargetHeaderVisibility(LockedTargetModel, true);
	end

	if ActiveReticleBillboard then
		ActiveReticleBillboard:Destroy();
		ActiveReticleBillboard = nil;
	end

	ReticleHealthFill = nil;
	ReticlePostureFill = nil;
	ReticleNameLabel = nil;

	return;
end

local function CreateReticleUI(TargetModel: Model): ()
	DestroyReticleUI();
	SetTargetHeaderVisibility(TargetModel, false);

	local TargetRoot: BasePart? = (TargetModel:FindFirstChild('UpperTorso') :: BasePart?) or (TargetModel:FindFirstChild('Torso') :: BasePart?) or (TargetModel:FindFirstChild('HumanoidRootPart') :: BasePart?);

	if not TargetRoot then return end

	local ReticleGui: BillboardGui = Instance.new('BillboardGui');
	ReticleGui.Name = 'CombatLockOnReticle';
	ReticleGui.Adornee = TargetRoot;
	ReticleGui.Size = UDim2.new(0, 140, 0, 74);
	ReticleGui.StudsOffset = Vector3.new(0.0, 1.4, 0.0);
	ReticleGui.AlwaysOnTop = true;
	ReticleGui.LightInfluence = 0.0;
	ReticleGui.Parent = TargetRoot;

	local DiamondFrame: Frame = Instance.new('Frame');
	DiamondFrame.Name = 'DiamondMarker';
	DiamondFrame.AnchorPoint = Vector2.new(0.5, 0.5);
	DiamondFrame.Position = UDim2.new(0.5, 0, 0.32, 0);
	DiamondFrame.Size = UDim2.new(0, 22, 0, 22);
	DiamondFrame.Rotation = 45.0;
	DiamondFrame.BackgroundColor3 = Color3.fromRGB(255, 75, 95);
	DiamondFrame.BackgroundTransparency = 0.55;
	DiamondFrame.Parent = ReticleGui;

	local DiamondCorner: UICorner = Instance.new('UICorner');
	DiamondCorner.CornerRadius = UDim.new(0, 4);
	DiamondCorner.Parent = DiamondFrame;

	local DiamondStroke: UIStroke = Instance.new('UIStroke');
	DiamondStroke.Color = Color3.fromRGB(255, 215, 95);
	DiamondStroke.Thickness = 2.2;
	DiamondStroke.Parent = DiamondFrame;

	local InfoCard: Frame = Instance.new('Frame');
	InfoCard.Name = 'TargetInfoCard';
	InfoCard.AnchorPoint = Vector2.new(0.5, 1.0);
	InfoCard.Position = UDim2.new(0.5, 0, 1.0, 0);
	InfoCard.Size = UDim2.new(1.0, 0, 0, 34);
	InfoCard.BackgroundColor3 = Color3.fromRGB(16, 18, 26);
	InfoCard.BackgroundTransparency = 0.18;
	InfoCard.Parent = ReticleGui;

	local CardCorner: UICorner = Instance.new('UICorner');
	CardCorner.CornerRadius = UDim.new(0, 6);
	CardCorner.Parent = InfoCard;

	local CardStroke: UIStroke = Instance.new('UIStroke');
	CardStroke.Color = Color3.fromRGB(255, 95, 110);
	CardStroke.Thickness = 1.2;
	CardStroke.Transparency = 0.35;
	CardStroke.Parent = InfoCard;

	local NameLabel: TextLabel = Instance.new('TextLabel');
	NameLabel.Size = UDim2.new(1.0, -8, 0, 14);
	NameLabel.Position = UDim2.new(0, 4, 0, 2);
	NameLabel.BackgroundTransparency = 1.0;
	NameLabel.Font = (Enum.Font.GothamBold);
	NameLabel.TextSize = 11;
	NameLabel.TextColor3 = Color3.fromRGB(245, 247, 255);
	NameLabel.Text = (TargetModel.Name);
	NameLabel.Parent = InfoCard;

	local HealthBack: Frame = Instance.new('Frame');
	HealthBack.Position = UDim2.new(0, 6, 0, 18);
	HealthBack.Size = UDim2.new(1.0, -12, 0, 6);
	HealthBack.BackgroundColor3 = Color3.fromRGB(35, 38, 48);
	HealthBack.BorderSizePixel = 0;
	HealthBack.Parent = InfoCard;

	local HealthFill: Frame = Instance.new('Frame');
	HealthFill.Size = UDim2.new(1.0, 0, 1.0, 0);
	HealthFill.BackgroundColor3 = Color3.fromRGB(235, 65, 85);
	HealthFill.BorderSizePixel = 0;
	HealthFill.Parent = HealthBack;

	local PostureBack: Frame = Instance.new('Frame');
	PostureBack.Position = UDim2.new(0, 6, 0, 26);
	PostureBack.Size = UDim2.new(1.0, -12, 0, 4);
	PostureBack.BackgroundColor3 = Color3.fromRGB(35, 38, 48);
	PostureBack.BorderSizePixel = 0;
	PostureBack.Parent = InfoCard;

	local PostureFill: Frame = Instance.new('Frame');
	PostureFill.Size = UDim2.new(1.0, 0, 1.0, 0);
	PostureFill.BackgroundColor3 = Color3.fromRGB(85, 210, 255);
	PostureFill.BorderSizePixel = 0;
	PostureFill.Parent = PostureBack;

	ActiveReticleBillboard = ReticleGui;
	ReticleHealthFill = HealthFill;
	ReticlePostureFill = PostureFill;
	ReticleNameLabel = NameLabel;

	return;
end

---> Clears any active Target Lock-On and removes the 3D diamond reticle.
local function ClearLockOn(): ()
	LockedTargetModel = nil;
	DestroyReticleUI();

	local Character: Model? = (LocalPlayer.Character);

	if Character then
		local Humanoid: Humanoid? = Character:FindFirstChildOfClass('Humanoid');

		if Humanoid and not StateHandler.GetBoolean(Character, 'IsClimbing') and not StateHandler.GetBoolean(Character, 'IsRagdolled') then
			Humanoid.AutoRotate = true;
		end
	end

	return;
end

---> Returns the currently locked target <Model>, if any.
local function GetLockedTarget(): (Model?)
	return LockedTargetModel;
end

local function FindBestLockOnCandidate(): (Model?)
	local Character: Model? = (LocalPlayer.Character);
	local ActiveCamera: Camera? = (WS.CurrentCamera);

	if not Character or not ActiveCamera then return nil end

	local MyRoot: BasePart? = (Character:FindFirstChild('HumanoidRootPart') :: BasePart?);

	if not MyRoot then return nil end

	local CandidatesPool: { [number?]: Instance } = { };
	local LiveFolder: Instance? = WS:FindFirstChild('Live');

	if LiveFolder then
		for _: number, ChildEntity: Instance in LiveFolder:GetChildren() do
			table.insert(CandidatesPool, ChildEntity);
		end
	end

	for _: number, OtherPlayer: Player in Players:GetPlayers() do
		if (OtherPlayer ~= LocalPlayer) and (OtherPlayer.Character) then
			table.insert(CandidatesPool, (OtherPlayer.Character :: Model));
		end
	end

	local BestTarget: Model? = nil;
	local BestScore: number = -9999.0;
	local CameraPosition: Vector3 = (ActiveCamera.CFrame.Position);
	local CameraLook: Vector3 = ((ActiveCamera.CFrame.LookVector).Unit);

	for _: number?, CandidateObj: Instance in CandidatesPool do
		if CandidateObj:IsA('Model') and (CandidateObj ~= Character) then
			local CandidateHumanoid: Humanoid? = CandidateObj:FindFirstChildOfClass('Humanoid');
			local CandidateRoot: BasePart? = (CandidateObj:FindFirstChild('HumanoidRootPart') :: BasePart?);

			if CandidateHumanoid and CandidateRoot and ((CandidateHumanoid.Health) > 0) then
				local WorldDistance: number = (((CandidateRoot.Position) - (MyRoot.Position)).Magnitude);

				if (WorldDistance <= (CombatTable.LockOnMaxDistance)) then
					local ToCandidate: Vector3 = (((CandidateRoot.Position) - CameraPosition).Unit);
					local ViewDot: number = CameraLook:Dot(ToCandidate);

					if (ViewDot >= 0.25) then
						local CandidateScore: number = ((ViewDot * 100.0) - (WorldDistance * 0.65));

						if (CandidateScore > BestScore) then
							BestScore = CandidateScore;
							BestTarget = CandidateObj;
						end
					end
				end
			end
		end
	end

	return BestTarget;
end

---> Toggles Target Lock-On onto the nearest valid enemy in front of the player's camera.
local function ToggleLockOn(): (Model?)
	if LockedTargetModel then
		ClearLockOn();

		return nil;
	end

	local CandidateTarget: Model? = FindBestLockOnCandidate();

	if CandidateTarget then
		LockedTargetModel = CandidateTarget;
		CreateReticleUI(CandidateTarget);
	end

	return LockedTargetModel;
end

---> Adds camera shake trauma (clamped between 0.0 and 1.0) for combat impacts.
local function AddTrauma(TraumaDelta: number): ()
	CurrentTrauma = math.clamp((CurrentTrauma + TraumaDelta), 0.0, 1.0);

	return;
end

---> Sets the baseline FOV state (`'Default'`, `'Sprint'`, `'Charge'`, `'Rage'`) driven by spring interpolation.
local function SetFOVState(StateName: string): ()
	if (StateName == 'Sprint') then
		DesiredBaseFOV = (CombatTable.SprintCameraFOV);
	elseif (StateName == 'Charge') then
		DesiredBaseFOV = (CombatTable.ChargeCameraFOV);
	elseif (StateName == 'Rage') then
		DesiredBaseFOV = ((CombatTable.BaseCameraFOV) + 5.0);
	else
		DesiredBaseFOV = (CombatTable.BaseCameraFOV);
	end

	return;
end

---> Smoothly punches the camera FieldOfView to <TargetFOV> (with zoom-in then zoom-out for Rage) and releases back to the spring baseline.
local function PunchFOV(TargetFOV: number, RecoveryDuration: number): ()
	if (TargetFOV >= 88.0) then
		ActiveFOVOverride = 58.0;

		task.delay(0.14, function(): ()
			ActiveFOVOverride = TargetFOV;

			task.delay(0.24, function(): ()
				ActiveFOVOverride = nil;

				return;
			end);

			return;
		end);

		return;
	end

	ActiveFOVOverride = TargetFOV;

	task.delay(0.085, function(): ()
		ActiveFOVOverride = nil;

		return;
	end);

	local ActiveCamera: Camera? = (WS.CurrentCamera);

	if not ActiveCamera then return end

	local SafeCamera: Camera = (ActiveCamera :: Camera);
	local PunchIn: Tween = TS:Create(SafeCamera, TweenInfo.new(0.07, (Enum.EasingStyle.Quad), (Enum.EasingDirection.Out)), {
		FieldOfView = TargetFOV,
	});
	PunchIn:Play();

	task.delay(0.085, function(): ()
		local CurrentCam: Camera? = (WS.CurrentCamera);

		if not CurrentCam then return end

		local PunchOut: Tween = TS:Create((CurrentCam :: Camera), TweenInfo.new(RecoveryDuration, (Enum.EasingStyle.Sine), (Enum.EasingDirection.Out)), {
			FieldOfView = DesiredBaseFOV,
		});
		PunchOut:Play();

		return;
	end);

	return;
end

---> Starts a Cubic Bezier camera trajectory (`'RageAwakening'`, `'VanishChase'`, `'HeavyFinish'`, `'GuardBreak'`).
local function PlayBezierSpline(SplineKind: string): ()
	local NowClock: number = os.clock();

	if (SplineKind == 'RageAwakening') then
		ActiveSpline = {
			StartTime = NowClock,
			Duration  = 0.65,
			Point0    = Vector3.zero,
			Point1    = Vector3.new(5.2, -2.6, -3.2),
			Point2    = Vector3.new(-4.2, 1.8, -1.8),
			Point3    = Vector3.zero,
			RollPeak  = math.rad(-8.5),
		};
	elseif (SplineKind == 'VanishChase') then
		ActiveSpline = {
			StartTime = NowClock,
			Duration  = 0.28,
			Point0    = Vector3.new(-3.8, 0.9, 3.2),
			Point1    = Vector3.new(5.4, 2.0, 1.2),
			Point2    = Vector3.new(1.4, -0.4, -1.6),
			Point3    = Vector3.zero,
			RollPeak  = math.rad(11.5),
		};
	elseif (SplineKind == 'GuardBreak') or (SplineKind == 'HeavyFinish') then
		ActiveSpline = {
			StartTime = NowClock,
			Duration  = 0.22,
			Point0    = Vector3.zero,
			Point1    = Vector3.new(1.35, -0.45, -2.6),
			Point2    = Vector3.new(-0.65, 0.25, -1.1),
			Point3    = Vector3.zero,
			RollPeak  = math.rad(9.0),
		};
	end

	return;
end

---> Pulses `Lighting` motion blur and bloom intensity for dashes, shockwaves, and heavy impacts.
local function PulseBlur(BlurPeak: number, Duration: number): ()
	if not RS:IsClient() then return end

	local _: ColorCorrectionEffect, BlurInstance: BlurEffect, BloomInstance: BloomEffect, _: DepthOfFieldEffect = EnsurePostProcessingEffects();
	BlurInstance.Size = math.max((BlurInstance.Size), BlurPeak);
	BloomInstance.Intensity = math.max((BloomInstance.Intensity), 1.45);

	local BlurFade: Tween = TS:Create(BlurInstance, TweenInfo.new(Duration, (Enum.EasingStyle.Quad), (Enum.EasingDirection.Out)), {
		Size = 0.0,
	});
	BlurFade:Play();

	local BloomFade: Tween = TS:Create(BloomInstance, TweenInfo.new(Duration, (Enum.EasingStyle.Quad), (Enum.EasingDirection.Out)), {
		Intensity = 0.4,
	});
	BloomFade:Play();

	return;
end

---> Triggers a 2-to-3 frame monochrome anime Impact Frame flash in `Lighting` (`'Parry'`, `'GuardBreak'`, `'Vanish'`, `'AirSlam'`, `'Rage'`).
local function TriggerImpactFrames(ImpactStyle: string?): ()
	if not RS:IsClient() then return end

	local CCInstance: ColorCorrectionEffect, BlurInstance: BlurEffect, BloomInstance: BloomEffect, _: DepthOfFieldEffect = EnsurePostProcessingEffects();
	local ResolvedStyle: string = ImpactStyle or 'Heavy';
	local StepTime: number = (CombatTable.ImpactFrameStepDuration);

	ImpactFrameToken = (ImpactFrameToken + 1);
	local MyToken: number = ImpactFrameToken;

	local FlashTint: Color3 = Color3.fromRGB(255, 245, 220);

	if (ResolvedStyle == 'Parry') then
		FlashTint = Color3.fromRGB(165, 245, 255);
	elseif (ResolvedStyle == 'GuardBreak') then
		FlashTint = Color3.fromRGB(255, 165, 180);
	elseif (ResolvedStyle == 'Vanish') then
		FlashTint = Color3.fromRGB(225, 175, 255);
	elseif (ResolvedStyle == 'Rage') then
		FlashTint = Color3.fromRGB(255, 170, 210);
	end

	---> Frame 1: High-Contrast Whiteout Monochrome Flash
	CCInstance.Saturation = -1.0;
	CCInstance.Contrast = 2.2;
	CCInstance.Brightness = 0.52;
	CCInstance.TintColor = FlashTint;
	BlurInstance.Size = (CombatTable.HeavyBlurSize);
	BloomInstance.Intensity = 2.35;

	---> Frame 2: Dark High-Contrast Silhouette Frame
	task.delay(StepTime, function(): ()
		if (ImpactFrameToken ~= MyToken) then return end

		CCInstance.Saturation = -1.0;
		CCInstance.Contrast = 2.75;
		CCInstance.Brightness = -0.34;
		CCInstance.TintColor = Color3.fromRGB(235, 240, 255);
		BlurInstance.Size = ((CombatTable.HeavyBlurSize) * 0.75);

		---> Frame 3: Smooth Tween Restore to Neutral Gameplay Lighting
		task.delay(StepTime, function(): ()
			if (ImpactFrameToken ~= MyToken) then return end

			local RestoreInfo: TweenInfo = TweenInfo.new(0.18, (Enum.EasingStyle.Quad), (Enum.EasingDirection.Out));
			local RestoreCC: Tween = TS:Create(CCInstance, RestoreInfo, {
				Saturation = 0.0,
				Contrast   = 0.0,
				Brightness = 0.0,
				TintColor  = Color3.fromRGB(255, 255, 255),
			});
			local RestoreBlur: Tween = TS:Create(BlurInstance, RestoreInfo, {
				Size = 0.0,
			});
			local RestoreBloom: Tween = TS:Create(BloomInstance, RestoreInfo, {
				Intensity = 0.4,
			});

			RestoreCC:Play();
			RestoreBlur:Play();
			RestoreBloom:Play();

			return;
		end);

		return;
	end);

	return;
end



if RS:IsClient() then
	EnsurePostProcessingEffects();

	RS:BindToRenderStep('CombatCameraFeelStep', ((Enum.RenderPriority.Camera.Value) + 1), function(DeltaTime: number): ()
		local ActiveCamera: Camera? = (WS.CurrentCamera);
		local Character: Model? = (LocalPlayer.Character);

		if not ActiveCamera or not Character then return end

		local SafeCamera: Camera = (ActiveCamera :: Camera);
		local MyRoot: BasePart? = (Character:FindFirstChild('HumanoidRootPart') :: BasePart?);
		local MyHumanoid: Humanoid? = Character:FindFirstChildOfClass('Humanoid');
		local _: ColorCorrectionEffect, _: BlurEffect, _: BloomEffect, DoFInstance: DepthOfFieldEffect = EnsurePostProcessingEffects();

		if MyHumanoid then
			local MoveSpeed: number = (MyHumanoid.MoveDirection.Magnitude);
			local IsRage: boolean = StateHandler.GetBoolean(Character, 'IsRageActive');

			if IsRage and (MoveSpeed > 0.1) then
				DesiredBaseFOV = (CombatTable.SprintCameraFOV);
			elseif IsRage then
				DesiredBaseFOV = ((CombatTable.BaseCameraFOV) + 4.0);
			else
				DesiredBaseFOV = (CombatTable.BaseCameraFOV);
			end
		end

		local TargetFOVGoal: number = ActiveFOVOverride or DesiredBaseFOV;
		CurrentSpringFOV = (CurrentSpringFOV + ((TargetFOVGoal - CurrentSpringFOV) * math.clamp((DeltaTime * 14.0), 0.0, 1.0)));
		SafeCamera.FieldOfView = CurrentSpringFOV;

		if LockedTargetModel and MyRoot and MyHumanoid then
			local TargetHumanoid: Humanoid? = LockedTargetModel:FindFirstChildOfClass('Humanoid');
			local TargetRoot: BasePart? = (LockedTargetModel:FindFirstChild('HumanoidRootPart') :: BasePart?);

			if not (LockedTargetModel.Parent) or not TargetHumanoid or not TargetRoot or ((TargetHumanoid.Health) <= 0) then
				ClearLockOn();
			else
				local SeparationDist: number = (((TargetRoot.Position) - (MyRoot.Position)).Magnitude);

				if (SeparationDist > (CombatTable.LockOnBreakDistance)) then
					ClearLockOn();
				else
					DoFInstance.FarIntensity = (CombatTable.LockOnDoFFarIntensity);
					DoFInstance.FocusDistance = SeparationDist;

					if ReticleHealthFill then
						local HealthRatio: number = math.clamp(((TargetHumanoid.Health) / (math.max(1.0, (TargetHumanoid.MaxHealth)))), 0.0, 1.0);
						ReticleHealthFill.Size = UDim2.new(HealthRatio, 0, 1.0, 0);
					end

					if ReticlePostureFill then
						local TargetPosture: number = StateHandler.GetNumber(LockedTargetModel, 'Posture', (CombatTable.MaxPosture));
						local MaxPosture: number = StateHandler.GetNumber(LockedTargetModel, 'MaxPosture', (CombatTable.MaxPosture));
						local PostureRatio: number = math.clamp((TargetPosture / (math.max(1.0, MaxPosture))), 0.0, 1.0);
						ReticlePostureFill.Size = UDim2.new(PostureRatio, 0, 1.0, 0);
					end

					if ReticleNameLabel then
						local TargetStyle: string = StateHandler.GetString(LockedTargetModel, 'EquippedWeapon', 'Fists');
						ReticleNameLabel.Text = `{LockedTargetModel.Name} [{TargetStyle}]`;
					end

					if not StateHandler.GetBoolean(Character, 'IsClimbing') and not StateHandler.GetBoolean(Character, 'IsRagdolled') then
						local PlanarTarget: Vector3 = Vector3.new((TargetRoot.Position.X), (MyRoot.Position.Y), (TargetRoot.Position.Z));

						if (((PlanarTarget - (MyRoot.Position)).Magnitude) > 0.25) then
							MyHumanoid.AutoRotate = false;
							local DesiredRootCF: CFrame = CFrame.lookAt((MyRoot.Position), PlanarTarget);
							MyRoot.CFrame = (MyRoot.CFrame):Lerp(DesiredRootCF, math.clamp((DeltaTime * 16.0), 0.0, 1.0));
						end
					end

					local CamPosition: Vector3 = (SafeCamera.CFrame.Position);
					local AimPoint: Vector3 = ((TargetRoot.Position) + Vector3.new(0.0, 1.2, 0.0));
					local DesiredCamCF: CFrame = CFrame.lookAt(CamPosition, AimPoint);
					SafeCamera.CFrame = (SafeCamera.CFrame):Lerp(DesiredCamCF, math.clamp((DeltaTime * 10.0), 0.0, 1.0));
				end
			end
		else
			DoFInstance.FarIntensity = (DoFInstance.FarIntensity + ((0.0 - (DoFInstance.FarIntensity)) * math.clamp((DeltaTime * 8.0), 0.0, 1.0)));
		end

		local DesiredSplineOffset: Vector3 = Vector3.zero;
		local DesiredSplineRoll: number = 0.0;

		if ActiveSpline then
			local CurrentSpline: BezierSplineState = (ActiveSpline :: BezierSplineState);
			local ElapsedSpline: number = (os.clock() - (CurrentSpline.StartTime));
			local SplineAlpha: number = (ElapsedSpline / (CurrentSpline.Duration));

			if (SplineAlpha >= 1.0) then
				ActiveSpline = nil;
			else
				DesiredSplineOffset = EvaluateCubicBezier((CurrentSpline.Point0), (CurrentSpline.Point1), (CurrentSpline.Point2), (CurrentSpline.Point3), SplineAlpha);
				DesiredSplineRoll = (math.sin((SplineAlpha * math.pi)) * (CurrentSpline.RollPeak));
			end
		end

		local SpringAlpha: number = math.clamp((DeltaTime * 18.0), 0.0, 1.0);
		SpringPositionOffset = SpringPositionOffset:Lerp(DesiredSplineOffset, SpringAlpha);
		SpringRollAngle = (SpringRollAngle + ((DesiredSplineRoll - SpringRollAngle) * SpringAlpha));

		if ((SpringPositionOffset.Magnitude) > 0.002) or ((math.abs(SpringRollAngle)) > 0.0005) then
			SafeCamera.CFrame = (((SafeCamera.CFrame) * CFrame.new(SpringPositionOffset)) * CFrame.Angles(0.0, 0.0, SpringRollAngle));
		end

		if (CurrentTrauma > 0.001) then
			local ShakeMagnitude: number = (CurrentTrauma * CurrentTrauma);
			local NowClock: number = (os.clock() * 42.0);
			local PitchShake: number = ((math.sin(NowClock) * 0.045) * ShakeMagnitude);
			local YawShake: number = ((math.cos((NowClock * 1.3)) * 0.045) * ShakeMagnitude);
			local RollShake: number = ((math.sin((NowClock * 0.85)) * 0.06) * ShakeMagnitude);

			SafeCamera.CFrame = ((SafeCamera.CFrame) * CFrame.Angles(PitchShake, YawShake, RollShake));
			CurrentTrauma = math.max(0.0, (CurrentTrauma - (DeltaTime * 2.6)));
		end

		return;
	end);
end



local CameraFeelController: CameraFeelControllerModule = {
	AddTrauma           = AddTrauma,
	PunchFOV            = PunchFOV,
	SetFOVState         = SetFOVState,
	PlayBezierSpline    = PlayBezierSpline,
	TriggerImpactFrames = TriggerImpactFrames,
	PulseBlur           = PulseBlur,
	ToggleLockOn        = ToggleLockOn,
	GetLockedTarget     = GetLockedTarget,
	ClearLockOn         = ClearLockOn,
};



return CameraFeelController;
