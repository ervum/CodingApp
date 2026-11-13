--!strict

local Players: Players = game:GetService('Players');
local ReplicatedStorage: ReplicatedStorage = game:GetService('ReplicatedStorage');
local TS: TweenService = game:GetService('TweenService');
local UIS: UserInputService = game:GetService('UserInputService');

local ModulesFolder: Instance = ReplicatedStorage:WaitForChild('Modules');
local RemoteFolder: Instance = ReplicatedStorage:WaitForChild('RemoteEvents');

local CombatTypes = require(ModulesFolder:WaitForChild('CombatTypes') :: ModuleScript);
local StateHandler = require(ModulesFolder:WaitForChild('StateHandler') :: ModuleScript);
local WeaponConfig = require(ModulesFolder:WaitForChild('WeaponConfig') :: ModuleScript);

local CombatActionRemote: RemoteEvent = (RemoteFolder:WaitForChild('CombatAction') :: RemoteEvent);



type WeaponDescriptor = CombatTypes.WeaponDescriptor;



local LocalPlayer: Player = Players.LocalPlayer;
local PlayerGui: PlayerGui = (LocalPlayer:WaitForChild('PlayerGui') :: PlayerGui);

local ExistingMenu: Instance? = PlayerGui:FindFirstChild('CharacterWeaponMenu');

if ExistingMenu then
	ExistingMenu:Destroy();
end

local MenuScreenGui: ScreenGui = Instance.new('ScreenGui');
MenuScreenGui.Name = 'CharacterWeaponMenu';
MenuScreenGui.ResetOnSpawn = false;
MenuScreenGui.ZIndexBehavior = (Enum.ZIndexBehavior.Sibling);
MenuScreenGui.Parent = PlayerGui;

local DrawerPanel: Frame = Instance.new('Frame');
DrawerPanel.Name = 'ArsenalDrawerPanel';
DrawerPanel.AnchorPoint = Vector2.new(0.5, 0.5);
DrawerPanel.Position = UDim2.new(0.5, 0, 0.46, 0);
DrawerPanel.Size = UDim2.new(0, 440, 0, 340);
DrawerPanel.BackgroundColor3 = Color3.fromRGB(18, 21, 30);
DrawerPanel.BackgroundTransparency = 0.06;
DrawerPanel.Visible = false;
DrawerPanel.Parent = MenuScreenGui;

local PanelCorner: UICorner = Instance.new('UICorner');
PanelCorner.CornerRadius = UDim.new(0, 14);
PanelCorner.Parent = DrawerPanel;

local PanelStroke: UIStroke = Instance.new('UIStroke');
PanelStroke.Color = Color3.fromRGB(95, 175, 255);
PanelStroke.Thickness = 1.8;
PanelStroke.Transparency = 0.25;
PanelStroke.Parent = DrawerPanel;

local HeaderTitle: TextLabel = Instance.new('TextLabel');
HeaderTitle.Position = UDim2.new(0, 18, 0, 14);
HeaderTitle.Size = UDim2.new(1.0, -36, 0, 24);
HeaderTitle.BackgroundTransparency = 1.0;
HeaderTitle.Font = (Enum.Font.GothamBlack);
HeaderTitle.TextSize = 18;
HeaderTitle.TextXAlignment = (Enum.TextXAlignment.Left);
HeaderTitle.TextColor3 = Color3.fromRGB(245, 248, 255);
HeaderTitle.Text = 'COMBAT ARSENAL & MARTIAL STYLES';
HeaderTitle.Parent = DrawerPanel;

local SubHeaderLabel: TextLabel = Instance.new('TextLabel');
SubHeaderLabel.Position = UDim2.new(0, 18, 0, 38);
SubHeaderLabel.Size = UDim2.new(1.0, -36, 0, 16);
SubHeaderLabel.BackgroundTransparency = 1.0;
SubHeaderLabel.Font = (Enum.Font.GothamMedium);
SubHeaderLabel.TextSize = 11;
SubHeaderLabel.TextXAlignment = (Enum.TextXAlignment.Left);
SubHeaderLabel.TextColor3 = Color3.fromRGB(160, 175, 205);
SubHeaderLabel.Text = 'Press [1-5] at any time or select a style below • [M] Close';
SubHeaderLabel.Parent = DrawerPanel;

local CloseModalButton: TextButton = Instance.new('TextButton');
CloseModalButton.Name = 'CloseModalButton';
CloseModalButton.AnchorPoint = Vector2.new(1.0, 0.0);
CloseModalButton.Position = UDim2.new(1.0, -10, 0, 10);
CloseModalButton.Size = UDim2.new(0, 44, 0, 44);
CloseModalButton.BackgroundColor3 = Color3.fromRGB(235, 82, 82);
CloseModalButton.Font = (Enum.Font.GothamBlack);
CloseModalButton.TextSize = 18;
CloseModalButton.TextColor3 = Color3.fromRGB(255, 255, 255);
CloseModalButton.Text = 'X';
CloseModalButton.Parent = DrawerPanel;

local CloseBtnCorner: UICorner = Instance.new('UICorner');
CloseBtnCorner.CornerRadius = UDim.new(0, 8);
CloseBtnCorner.Parent = CloseModalButton;

CloseModalButton.MouseButton1Click:Connect(function(): ()
	DrawerPanel.Visible = false;

	return;
end);

local CardsContainer: Frame = Instance.new('Frame');
CardsContainer.Name = 'StyleCardsContainer';
CardsContainer.Position = UDim2.new(0, 16, 0, 62);
CardsContainer.Size = UDim2.new(1.0, -32, 1.0, -76);
CardsContainer.BackgroundTransparency = 1.0;
CardsContainer.Parent = DrawerPanel;

local CardsLayout: UIListLayout = Instance.new('UIListLayout');
CardsLayout.Padding = UDim.new(0, 8);
CardsLayout.FillDirection = (Enum.FillDirection.Vertical);
CardsLayout.SortOrder = (Enum.SortOrder.LayoutOrder);
CardsLayout.Parent = CardsContainer;



local StyleStatusBadges: { [string?]: TextLabel } = { };
local StyleStrokeMap: { [string?]: UIStroke } = { };

local function RefreshSelectedHighlight(): ()
	local Character: Model? = (LocalPlayer.Character);
	local EquippedName: string = Character and StateHandler.GetString(Character, 'EquippedWeapon', 'Fists') or 'Fists';

	for StyleKey: string?, StatusLabel: TextLabel in StyleStatusBadges do
		local IsEquipped: boolean = (StyleKey == EquippedName);
		StatusLabel.Text = IsEquipped and 'EQUIPPED' or 'EQUIP';
		StatusLabel.TextColor3 = IsEquipped and Color3.fromRGB(95, 245, 165) or Color3.fromRGB(185, 195, 220);

		local CardStroke: UIStroke? = StyleStrokeMap[StyleKey];

		if CardStroke then
			CardStroke.Thickness = IsEquipped and 2.2 or 1.2;
			CardStroke.Transparency = IsEquipped and 0.05 or 0.55;
		end
	end

	return;
end

for OrderIndex: number?, StyleName: string in WeaponConfig.OrderedStyles do
	local WeaponData: WeaponDescriptor = WeaponConfig.GetWeapon(StyleName);
	local SafeOrder: number = OrderIndex or 1;

	local StyleButton: TextButton = Instance.new('TextButton');
	StyleButton.Name = {StyleName}CardButton;
	StyleButton.LayoutOrder = SafeOrder;
	StyleButton.Size = UDim2.new(1.0, 0, 0, 46);
	StyleButton.BackgroundColor3 = Color3.fromRGB(26, 30, 44);
	StyleButton.AutoButtonColor = true;
	StyleButton.Text = '';
	StyleButton.Parent = CardsContainer;

	local ButtonCorner: UICorner = Instance.new('UICorner');
	ButtonCorner.CornerRadius = UDim.new(0, 8);
	ButtonCorner.Parent = StyleButton;

	local ButtonStroke: UIStroke = Instance.new('UIStroke');
	ButtonStroke.Color = (WeaponData.AccentColor);
	ButtonStroke.Thickness = 1.2;
	ButtonStroke.Transparency = 0.55;
	ButtonStroke.Parent = StyleButton;
	StyleStrokeMap[StyleName] = ButtonStroke;

	local TitleText: TextLabel = Instance.new('TextLabel');
	TitleText.Position = UDim2.new(0, 12, 0, 5);
	TitleText.Size = UDim2.new(0.65, 0, 0, 18);
	TitleText.BackgroundTransparency = 1.0;
	TitleText.Font = (Enum.Font.GothamBlack);
	TitleText.TextSize = 14;
	TitleText.TextXAlignment = (Enum.TextXAlignment.Left);
	TitleText.TextColor3 = (WeaponData.AccentColor);
	TitleText.Text = [{WeaponData.HotkeyNumber}] {string.upper(WeaponData.DisplayName)};
	TitleText.Parent = StyleButton;

	local StatsText: TextLabel = Instance.new('TextLabel');
	StatsText.Position = UDim2.new(0, 12, 0, 24);
	StatsText.Size = UDim2.new(0.72, 0, 0, 16);
	StatsText.BackgroundTransparency = 1.0;
	StatsText.Font = (Enum.Font.GothamMedium);
	StatsText.TextSize = 11;
	StatsText.TextXAlignment = (Enum.TextXAlignment.Left);
	StatsText.TextColor3 = Color3.fromRGB(190, 200, 222);
	StatsText.Text = M1 DMG: {WeaponData.Damage} • Heavy DMG: {WeaponData.HeavyDamage} • Tempo: {WeaponData.SwingCooldown}s;
	StatsText.Parent = StyleButton;

	local ActionBadge: TextLabel = Instance.new('TextLabel');
	ActionBadge.Position = UDim2.new(0.74, 0, 0, 0);
	ActionBadge.Size = UDim2.new(0.26, -12, 1.0, 0);
	ActionBadge.BackgroundTransparency = 1.0;
	ActionBadge.Font = (Enum.Font.GothamBlack);
	ActionBadge.TextSize = 12;
	ActionBadge.TextXAlignment = (Enum.TextXAlignment.Right);
	ActionBadge.TextColor3 = Color3.fromRGB(185, 195, 220);
	ActionBadge.Text = 'EQUIP';
	ActionBadge.Parent = StyleButton;

	StyleStatusBadges[StyleName] = ActionBadge;

	StyleButton.MouseButton1Click:Connect(function(): ()
		CombatActionRemote:FireServer('SwitchWeapon', { WeaponName = StyleName });
		DrawerPanel.Visible = false;

		return;
	end);
end



local function BindWeaponAttribute(Character: Model): ()
	Character:GetAttributeChangedSignal('EquippedWeapon'):Connect(function(): ()
		RefreshSelectedHighlight();

		return;
	end);

	RefreshSelectedHighlight();

	return;
end

if (LocalPlayer.Character) then
	BindWeaponAttribute(LocalPlayer.Character :: Model);
end

LocalPlayer.CharacterAdded:Connect(function(NewCharacter: Model): ()
	BindWeaponAttribute(NewCharacter);

	return;
end);

UIS.InputBegan:Connect(function(InputObject: InputObject, GameProcessed: boolean): ()
	if GameProcessed then return end

	if (InputObject.KeyCode == (Enum.KeyCode.M)) then
		local NextVisibility: boolean = (not (DrawerPanel.Visible));
		DrawerPanel.Visible = NextVisibility;

		if NextVisibility then
			RefreshSelectedHighlight();
			DrawerPanel.Size = UDim2.new(0, 410, 0, 315);

			local OpenTween: Tween = TS:Create(DrawerPanel, TweenInfo.new(0.18, (Enum.EasingStyle.Back), (Enum.EasingDirection.Out)), {
				Size = UDim2.new(0, 440, 0, 340),
			});
			OpenTween:Play();
		end
	end

	return;
end);
