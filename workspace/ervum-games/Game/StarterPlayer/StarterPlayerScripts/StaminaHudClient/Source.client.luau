--!strict

local Players: Players = game:GetService('Players');
local ReplicatedStorage: ReplicatedStorage = game:GetService('ReplicatedStorage');
local TS: TweenService = game:GetService('TweenService');
local WS: Workspace = game:GetService('Workspace');

local ModulesFolder: Instance = ReplicatedStorage:WaitForChild('Modules');
local RemoteFolder: Instance = ReplicatedStorage:WaitForChild('RemoteEvents');

local AnimationHandler = require(ModulesFolder:WaitForChild('AnimationHandler') :: ModuleScript);
local CombatTable = require(ModulesFolder:WaitForChild('CombatTable') :: ModuleScript);
local SoundHandler = require(ModulesFolder:WaitForChild('SoundHandler') :: ModuleScript);
local StateHandler = require(ModulesFolder:WaitForChild('StateHandler') :: ModuleScript);
local WeaponConfig = require(ModulesFolder:WaitForChild('WeaponConfig') :: ModuleScript);

local CombatActionRemote: RemoteEvent = (RemoteFolder:WaitForChild('CombatAction') :: RemoteEvent);



type MeterBarCluster = {
	ContainerFrame: Frame,
	PrimaryFill: Frame,
	GhostFill: Frame,
	ValueLabel: TextLabel,
};



local LocalPlayer: Player = Players.LocalPlayer;
local PlayerGui: PlayerGui = (LocalPlayer:WaitForChild('PlayerGui') :: PlayerGui);

local ExistingHud: Instance? = PlayerGui:FindFirstChild('CombatHUD');

if ExistingHud then
	ExistingHud:Destroy();
end

local HudScreenGui: ScreenGui = Instance.new('ScreenGui');
HudScreenGui.Name = 'CombatHUD';
HudScreenGui.ResetOnSpawn = false;
HudScreenGui.IgnoreGuiInset = true;
HudScreenGui.ZIndexBehavior = (Enum.ZIndexBehavior.Sibling);
HudScreenGui.Parent = PlayerGui;



local function ApplyCardStyle(TargetFrame: Frame, CornerRadiusPx: number, StrokeColor: Color3, StrokeOpacity: number): (UIStroke)
	local Corner: UICorner = Instance.new('UICorner');
	Corner.CornerRadius = UDim.new(0, CornerRadiusPx);
	Corner.Parent = TargetFrame;

	local Stroke: UIStroke = Instance.new('UIStroke');
	Stroke.Color = StrokeColor;
	Stroke.Thickness = 1.4;
	Stroke.Transparency = StrokeOpacity;
	Stroke.Parent = TargetFrame;

	return Stroke;
end

local function CreateMeterBar(ParentFrame: Frame, BarName: string, YOffset: number, BarHeight: number, FillColor: Color3, GhostColor: Color3, LabelPrefix: string): (MeterBarCluster)
	local TrackFrame: Frame = Instance.new('Frame');
	TrackFrame.Name = BarName;
	TrackFrame.Position = UDim2.new(0, 14, 0, YOffset);
	TrackFrame.Size = UDim2.new(1.0, -28, 0, BarHeight);
	TrackFrame.BackgroundColor3 = Color3.fromRGB(14, 16, 24);
	TrackFrame.BorderSizePixel = 0;
	TrackFrame.Parent = ParentFrame;

	ApplyCardStyle(TrackFrame, 6, Color3.fromRGB(58, 66, 88), 0.35);

	local GhostBar: Frame = Instance.new('Frame');
	GhostBar.Name = 'GhostFill';
	GhostBar.Size = UDim2.new(1.0, 0, 1.0, 0);
	GhostBar.BackgroundColor3 = GhostColor;
	GhostBar.BackgroundTransparency = 0.25;
	GhostBar.BorderSizePixel = 0;
	GhostBar.ZIndex = 2;
	GhostBar.Parent = TrackFrame;

	local GhostCorner: UICorner = Instance.new('UICorner');
	GhostCorner.CornerRadius = UDim.new(0, 6);
	GhostCorner.Parent = GhostBar;

	local PrimaryBar: Frame = Instance.new('Frame');
	PrimaryBar.Name = 'PrimaryFill';
	PrimaryBar.Size = UDim2.new(1.0, 0, 1.0, 0);
	PrimaryBar.BackgroundColor3 = FillColor;
	PrimaryBar.BorderSizePixel = 0;
	PrimaryBar.ZIndex = 3;
	PrimaryBar.Parent = TrackFrame;

	local PrimaryCorner: UICorner = Instance.new('UICorner');
	PrimaryCorner.CornerRadius = UDim.new(0, 6);
	PrimaryCorner.Parent = PrimaryBar;

	local ReadoutLabel: TextLabel = Instance.new('TextLabel');
	ReadoutLabel.Size = UDim2.new(1.0, -12, 1.0, 0);
	ReadoutLabel.Position = UDim2.new(0, 8, 0, 0);
	ReadoutLabel.BackgroundTransparency = 1.0;
	ReadoutLabel.Font = (Enum.Font.GothamBold);
	ReadoutLabel.TextSize = 11;
	ReadoutLabel.TextXAlignment = (Enum.TextXAlignment.Left);
	ReadoutLabel.TextColor3 = Color3.fromRGB(245, 248, 255);
	ReadoutLabel.TextStrokeTransparency = 0.35;
	ReadoutLabel.Text = {LabelPrefix}: 100 / 100;
	ReadoutLabel.ZIndex = 4;
	ReadoutLabel.Parent = TrackFrame;

	local Cluster: MeterBarCluster = {
		ContainerFrame = TrackFrame,
		PrimaryFill = PrimaryBar,
		GhostFill = GhostBar,
		ValueLabel = ReadoutLabel,
	};

	return Cluster;
end

local function CreateHotbarSlot(ParentBar: Frame, KeyText: string, ActionTitle: string, LayoutOrderIndex: number): (Frame)
	local SlotFrame: Frame = Instance.new('Frame');
	SlotFrame.Name = Slot_{ActionTitle};
	SlotFrame.Size = UDim2.new(0, 64, 0, 44);
	SlotFrame.LayoutOrder = LayoutOrderIndex;
	SlotFrame.BackgroundColor3 = Color3.fromRGB(20, 23, 34);
	SlotFrame.BackgroundTransparency = 0.12;
	SlotFrame.Parent = ParentBar;

	ApplyCardStyle(SlotFrame, 8, Color3.fromRGB(75, 88, 120), 0.35);

	local KeyBadge: TextLabel = Instance.new('TextLabel');
	KeyBadge.Size = UDim2.new(1.0, -8, 0, 18);
	KeyBadge.Position = UDim2.new(0, 4, 0, 4);
	KeyBadge.BackgroundTransparency = 1.0;
	KeyBadge.Font = (Enum.Font.GothamBlack);
	KeyBadge.TextSize = 13;
	KeyBadge.TextColor3 = Color3.fromRGB(115, 195, 255);
	KeyBadge.Text = [{KeyText}];
	KeyBadge.Parent = SlotFrame;

	local ActionLabel: TextLabel = Instance.new('TextLabel');
	ActionLabel.Size = UDim2.new(1.0, -4, 0, 16);
	ActionLabel.Position = UDim2.new(0, 2, 0, 23);
	ActionLabel.BackgroundTransparency = 1.0;
	ActionLabel.Font = (Enum.Font.GothamMedium);
	ActionLabel.TextSize = 10;
	ActionLabel.TextColor3 = Color3.fromRGB(210, 218, 235);
	ActionLabel.Text = ActionTitle;
	ActionLabel.Parent = SlotFrame;

	return SlotFrame;
end



local MainStatusCard: Frame = Instance.new('Frame');
MainStatusCard.Name = 'MainStatusCard';
MainStatusCard.AnchorPoint = Vector2.new(0.5, 1.0);
MainStatusCard.Position = UDim2.new(0.5, 0, 1.0, -72);
MainStatusCard.Size = UDim2.new(0, 380, 0, 118);
MainStatusCard.BackgroundColor3 = Color3.fromRGB(18, 21, 30);
MainStatusCard.BackgroundTransparency = 0.12;
MainStatusCard.Parent = HudScreenGui;

ApplyCardStyle(MainStatusCard, 12, Color3.fromRGB(80, 95, 130), 0.25);

local StyleBadgeLabel: TextLabel = Instance.new('TextLabel');
StyleBadgeLabel.Name = 'StyleBadgeLabel';
StyleBadgeLabel.Position = UDim2.new(0, 14, 0, 6);
StyleBadgeLabel.Size = UDim2.new(0.55, 0, 0, 18);
StyleBadgeLabel.BackgroundTransparency = 1.0;
StyleBadgeLabel.Font = (Enum.Font.GothamBlack);
StyleBadgeLabel.TextSize = 12;
StyleBadgeLabel.TextXAlignment = (Enum.TextXAlignment.Left);
StyleBadgeLabel.TextColor3 = Color3.fromRGB(245, 200, 85);
StyleBadgeLabel.Text = 'STYLE: FISTS • COMBO 1x';
StyleBadgeLabel.Parent = MainStatusCard;

local LockHintLabel: TextLabel = Instance.new('TextLabel');
LockHintLabel.Name = 'LockHintLabel';
LockHintLabel.Position = UDim2.new(0.45, 0, 0, 6);
LockHintLabel.Size = UDim2.new(0.55, -14, 0, 18);
LockHintLabel.BackgroundTransparency = 1.0;
LockHintLabel.Font = (Enum.Font.GothamBold);
LockHintLabel.TextSize = 10;
LockHintLabel.TextXAlignment = (Enum.TextXAlignment.Right);
LockHintLabel.TextColor3 = Color3.fromRGB(155, 175, 210);
LockHintLabel.Text = '[ALT / MMB] LOCK-ON [1-5 / M] WEAPONS';
LockHintLabel.Parent = MainStatusCard;

local HealthMeter: MeterBarCluster = CreateMeterBar(MainStatusCard, 'HealthMeter', 28, 18, Color3.fromRGB(235, 65, 85), Color3.fromRGB(255, 240, 240), 'HP');
local StaminaMeter: MeterBarCluster = CreateMeterBar(MainStatusCard, 'StaminaMeter', 50, 16, Color3.fromRGB(55, 195, 255), Color3.fromRGB(255, 215, 120), 'STM');
local PostureMeter: MeterBarCluster = CreateMeterBar(MainStatusCard, 'PostureMeter', 70, 14, Color3.fromRGB(95, 235, 185), Color3.fromRGB(255, 125, 95), 'GUARD');
local RageMeter: MeterBarCluster = CreateMeterBar(MainStatusCard, 'RageMeter', 88, 14, Color3.fromRGB(255, 155, 45), Color3.fromRGB(255, 225, 125), 'RAGE');

local HotbarRow: Frame = Instance.new('Frame');
HotbarRow.Name = 'ActionHotbarRow';
HotbarRow.AnchorPoint = Vector2.new(0.5, 1.0);
HotbarRow.Position = UDim2.new(0.5, 0, 1.0, -18);
HotbarRow.Size = UDim2.new(0, 480, 0, 46);
HotbarRow.BackgroundTransparency = 1.0;
HotbarRow.Parent = HudScreenGui;

local HotbarLayout: UIListLayout = Instance.new('UIListLayout');
HotbarLayout.FillDirection = (Enum.FillDirection.Horizontal);
HotbarLayout.HorizontalAlignment = (Enum.HorizontalAlignment.Center);
HotbarLayout.VerticalAlignment = (Enum.VerticalAlignment.Center);
HotbarLayout.SortOrder = (Enum.SortOrder.LayoutOrder);
HotbarLayout.Padding = UDim.new(0, 8);
HotbarLayout.Parent = HotbarRow;

local M1SlotFrame: Frame = CreateHotbarSlot(HotbarRow, 'M1', 'Combo', 1);
CreateHotbarSlot(HotbarRow, 'R', 'Heavy', 2);
CreateHotbarSlot(HotbarRow, 'F', 'Block/Parry', 3);
CreateHotbarSlot(HotbarRow, 'Q', 'Dash', 4);
CreateHotbarSlot(HotbarRow, 'SPC', 'Climb/Glide', 5);
CreateHotbarSlot(HotbarRow, 'G', 'Rage', 6);
local ArsenalSlotFrame: Frame = CreateHotbarSlot(HotbarRow, 'M', 'Arsenal', 7);

local M1SlotClickButton: TextButton = Instance.new('TextButton');
M1SlotClickButton.Size = UDim2.new(1.0, 0, 1.0, 0);
M1SlotClickButton.BackgroundTransparency = 1.0;
M1SlotClickButton.Text = '';
M1SlotClickButton.Parent = M1SlotFrame;

local function TriggerHudM1Attack(): ()
	local Character: Model? = (LocalPlayer.Character);

	if not Character then return end

	CombatActionRemote:FireServer('LightAttack', nil);

	if StateHandler.CanAct(Character) or StateHandler.GetBoolean(Character, 'CanVanishFollowUp') then
		local StyleName: string = StateHandler.GetString(Character, 'EquippedWeapon', 'Fists');
		local StepNumber: number = math.clamp(StateHandler.GetNumber(Character, 'Combo', 1), 1, 4);
		local IsFinisher: boolean = (StepNumber == 4);
		local PoseKey: string = (StyleName == 'Fists') and ('FistCombo' .. tostring(StepNumber)) or ('Combo' .. tostring(StepNumber));

		AnimationHandler.PlayProceduralPose(Character, PoseKey, IsFinisher and 1.15 or 1.38);
		SoundHandler.PlaySwing(Character, StyleName, IsFinisher);

		local OriginRoot: BasePart? = (Character:FindFirstChild('HumanoidRootPart') :: BasePart?);
		local LiveFolder: Instance? = WS:FindFirstChild('Live');

		if OriginRoot and LiveFolder then
			for : number, ChildObj: Instance in LiveFolder:GetChildren() do
				if ChildObj:IsA('Model') and (ChildObj ~= Character) then
					local EnemyHum: Humanoid? = ChildObj:FindFirstChildOfClass('Humanoid');
					local EnemyRoot: BasePart? = (ChildObj:FindFirstChild('HumanoidRootPart') :: BasePart?) or (ChildObj.PrimaryPart);

					if EnemyHum and EnemyRoot and ((EnemyHum.Health) > 0) and ((((EnemyRoot.Position) - (OriginRoot.Position)).Magnitude) <= 9.5) then
						SoundHandler.PlayImpact(ChildObj, 'Hit', StyleName, IsFinisher);
						break;
					end
				end
			end
		end
	end

	return;
end

M1SlotClickButton.MouseButton1Click:Connect(function(): ()
	TriggerHudM1Attack();

	return;
end);

local MobileHitButton: TextButton = Instance.new('TextButton');
MobileHitButton.Name = 'PrimaryHitActionButton';
MobileHitButton.AnchorPoint = Vector2.new(1.0, 1.0);
MobileHitButton.Position = UDim2.new(1.0, -24, 1.0, -184);
MobileHitButton.Size = UDim2.new(0, 88, 0, 88);
MobileHitButton.BackgroundColor3 = Color3.fromRGB(68, 214, 72);
MobileHitButton.Font = (Enum.Font.GothamBlack);
MobileHitButton.TextSize = 18;
MobileHitButton.TextColor3 = Color3.fromRGB(255, 255, 255);
MobileHitButton.TextStrokeColor3 = Color3.fromRGB(20, 20, 28);
MobileHitButton.TextStrokeTransparency = 0.0;
MobileHitButton.Text = ('HIT' .. string.char(10) .. '[M1]');
MobileHitButton.Parent = HudScreenGui;

local HitBtnCorner: UICorner = Instance.new('UICorner');
HitBtnCorner.CornerRadius = UDim.new(0, 16);
HitBtnCorner.Parent = MobileHitButton;

local HitBtnStroke: UIStroke = Instance.new('UIStroke');
HitBtnStroke.Color = Color3.fromRGB(20, 20, 28);
HitBtnStroke.Thickness = 3.0;
HitBtnStroke.Parent = MobileHitButton;

local HitBtnAspect: UIAspectRatioConstraint = Instance.new('UIAspectRatioConstraint');
HitBtnAspect.AspectRatio = 1.0;
HitBtnAspect.Parent = MobileHitButton;

MobileHitButton.MouseButton1Click:Connect(function(): ()
	TriggerHudM1Attack();

	return;
end);

local ArsenalClickButton: TextButton = Instance.new('TextButton');
ArsenalClickButton.Size = UDim2.new(1.0, 0, 1.0, 0);
ArsenalClickButton.BackgroundTransparency = 1.0;
ArsenalClickButton.Text = '';
ArsenalClickButton.Parent = ArsenalSlotFrame;

ArsenalClickButton.MouseButton1Click:Connect(function(): ()
	local MenuGui: Instance? = PlayerGui:FindFirstChild('CharacterWeaponMenu');
	local DrawerFrame: Frame? = MenuGui and (MenuGui:FindFirstChild('ArsenalDrawerPanel') :: Frame?) or nil;

	if DrawerFrame then
		DrawerFrame.Visible = (not (DrawerFrame.Visible));
	end

	return;
end);



local function TweenMeterWithGhost(Meter: MeterBarCluster, CurrentValue: number, MaxValue: number, LabelText: string, DynamicColor: Color3?): ()
	local SafeMax: number = math.max(1.0, MaxValue);
	local Ratio: number = math.clamp((CurrentValue / SafeMax), 0.0, 1.0);

	Meter.ValueLabel.Text = LabelText;

	local FastInfo: TweenInfo = TweenInfo.new(0.1, (Enum.EasingStyle.Quad), (Enum.EasingDirection.Out));
	local PrimaryProps: { [string]: UDim2 | Color3 } = {
		Size = UDim2.new(Ratio, 0, 1.0, 0),
	};

	if DynamicColor then
		PrimaryProps.BackgroundColor3 = DynamicColor;
	end

	TS:Create((Meter.PrimaryFill), FastInfo, PrimaryProps):Play();

	task.delay(0.28, function(): ()
		if not (Meter.GhostFill.Parent) then return end

		local GhostInfo: TweenInfo = TweenInfo.new(0.35, (Enum.EasingStyle.Sine), (Enum.EasingDirection.Out));
		TS:Create((Meter.GhostFill), GhostInfo, {
			Size = UDim2.new(Ratio, 0, 1.0, 0),
		}):Play();

		return;
	end);

	return;
end

local function BindCharacterHUD(Character: Model): ()
	local Humanoid: Humanoid? = (Character:WaitForChild('Humanoid', 5.0) :: Humanoid?);

	local function RefreshHealth(): ()
		if not Humanoid then return end

		local CurHP: number = math.floor(((Humanoid.Health) + 0.5));
		local MaxHP: number = math.floor(((Humanoid.MaxHealth) + 0.5));
		TweenMeterWithGhost(HealthMeter, CurHP, MaxHP, HP: {CurHP} / {MaxHP}, nil);

		return;
	end

	local function RefreshStamina(): ()
		local CurStamina: number = StateHandler.GetNumber(Character, 'Stamina', (CombatTable.MaxStamina));
		local MaxStamina: number = StateHandler.GetNumber(Character, 'MaxStamina', (CombatTable.MaxStamina));
		local Ratio: number = (CurStamina / (math.max(1.0, MaxStamina)));
		local BarColor: Color3 = (Ratio < 0.25) and Color3.fromRGB(255, 85, 85) or Color3.fromRGB(55, 195, 255);

		TweenMeterWithGhost(StaminaMeter, CurStamina, MaxStamina, STM: {math.floor(CurStamina)} / {math.floor(MaxStamina)}, BarColor);

		return;
	end

	local function RefreshPosture(): ()
		local CurPosture: number = StateHandler.GetNumber(Character, 'Posture', (CombatTable.MaxPosture));
		local MaxPosture: number = StateHandler.GetNumber(Character, 'MaxPosture', (CombatTable.MaxPosture));
		local Ratio: number = (CurPosture / (math.max(1.0, MaxPosture)));
		local GuardColor: Color3 = (Ratio < 0.35) and Color3.fromRGB(255, 75, 85) or Color3.fromRGB(95, 235, 185);

		TweenMeterWithGhost(PostureMeter, CurPosture, MaxPosture, GUARD STABILITY: {math.floor(CurPosture)}%, GuardColor);

		return;
	end

	local function RefreshRage(): ()
		local CurRage: number = StateHandler.GetNumber(Character, 'Rage', 0.0);
		local MaxRage: number = StateHandler.GetNumber(Character, 'MaxRage', (CombatTable.MaxRage));
		local IsRageActive: boolean = StateHandler.GetBoolean(Character, 'IsRageActive');
		local RageStatus: string = IsRageActive and 'RAGE AWAKENED! (ACTIVE)' or ((CurRage >= MaxRage) and 'RAGE READY! PRESS [G]' or RAGE: {math.floor(CurRage)}%);
		local RageColor: Color3 = ((CurRage >= MaxRage) or IsRageActive) and Color3.fromRGB(255, 215, 65) or Color3.fromRGB(255, 140, 45);

		TweenMeterWithGhost(RageMeter, CurRage, MaxRage, RageStatus, RageColor);

		return;
	end

	local function RefreshStyleAndCombo(): ()
		local EquippedStyle: string = StateHandler.GetString(Character, 'EquippedWeapon', 'Fists');
		local ComboCount: number = StateHandler.GetNumber(Character, 'Combo', 1);
		local WeaponDescriptor = WeaponConfig.GetWeapon(EquippedStyle);
		local UpperStyle: string = string.upper(EquippedStyle);

		StyleBadgeLabel.Text = STYLE: {UpperStyle} • COMBO {ComboCount}x;
		StyleBadgeLabel.TextColor3 = (WeaponDescriptor.AccentColor);

		return;
	end

	if Humanoid then
		Humanoid.HealthChanged:Connect(function(: number): ()
			RefreshHealth();

			return;
		end);

		RefreshHealth();
	end

	Character:GetAttributeChangedSignal('Stamina'):Connect(RefreshStamina);
	Character:GetAttributeChangedSignal('Posture'):Connect(RefreshPosture);
	Character:GetAttributeChangedSignal('Rage'):Connect(RefreshRage);
	Character:GetAttributeChangedSignal('IsRageActive'):Connect(RefreshRage);
	Character:GetAttributeChangedSignal('EquippedWeapon'):Connect(RefreshStyleAndCombo);
	Character:GetAttributeChangedSignal('Combo'):Connect(RefreshStyleAndCombo);

	RefreshStamina();
	RefreshPosture();
	RefreshRage();
	RefreshStyleAndCombo();

	return;
end



if (LocalPlayer.Character) then
	BindCharacterHUD(LocalPlayer.Character :: Model);
end

LocalPlayer.CharacterAdded:Connect(function(NewCharacter: Model): ()
	BindCharacterHUD(NewCharacter);

	return;
end);
