--!strict

local D: Debris = game:GetService('Debris');
local TS: TweenService = game:GetService('TweenService');
local WS: Workspace = game:GetService('Workspace');



export type DamageIndicatorModule = {
	Spawn:            ((Instance, number, boolean?) -> ()),
	SpawnCallout:     ((Instance, string, Color3, number?) -> ()),
	ShowVanishPrompt: ((Instance, number?) -> ()),
	HideVanishPrompt: ((Instance?) -> ()),
};



local ActiveVanishPromptGui: BillboardGui? = nil;



local function ResolveIndicatorPart(TargetEntity: Instance): (BasePart?)
	if TargetEntity:IsA('Model') then
		local RootPart: BasePart? = (TargetEntity:FindFirstChild('HumanoidRootPart') :: BasePart?) or (TargetEntity:FindFirstChild('Torso') :: BasePart?) or (TargetEntity.PrimaryPart);

		return RootPart;
	elseif TargetEntity:IsA('BasePart') then
		return TargetEntity;
	end

	return nil;
end

local function ResolveIndicatorPosition(TargetEntity: Instance): (Vector3?)
	local TargetPart: BasePart? = ResolveIndicatorPart(TargetEntity);

	if TargetPart then
		return (TargetPart.Position);
	end

	return nil;
end

---> Hides any active `[Q] VANISH STRIKE!` `BillboardGui` prompt on the launched target.
local function HideVanishPrompt(TargetEntity: Instance?): ()
	if ActiveVanishPromptGui then
		ActiveVanishPromptGui:Destroy();
		ActiveVanishPromptGui = nil;
	end

	if TargetEntity then
		local TargetPart: BasePart? = ResolveIndicatorPart(TargetEntity);

		if TargetPart then
			local ExistingPrompt: Instance? = TargetPart:FindFirstChild('VanishStrikePromptBillboard');

			if ExistingPrompt then
				ExistingPrompt:Destroy();
			end
		end
	end

	return;
end

---> Attaches a pulsing `[Q] VANISH STRIKE!` `BillboardGui` prompt directly onto the launched <TargetEntity>.
local function ShowVanishPrompt(TargetEntity: Instance, Duration: number?): ()
	if not TargetEntity then return end

	HideVanishPrompt(TargetEntity);

	local TargetPart: BasePart? = ResolveIndicatorPart(TargetEntity);

	if not TargetPart then return end

	local PromptDuration: number = Duration or 0.85;

	local PromptBillboard: BillboardGui = Instance.new('BillboardGui');
	PromptBillboard.Name = 'VanishStrikePromptBillboard';
	PromptBillboard.Adornee = TargetPart;
	PromptBillboard.Size = UDim2.new(0, 196, 0, 38);
	PromptBillboard.StudsOffset = Vector3.new(0.0, 3.8, 0.0);
	PromptBillboard.AlwaysOnTop = true;
	PromptBillboard.LightInfluence = 0.0;
	PromptBillboard.Parent = TargetPart;

	local PromptCard: Frame = Instance.new('Frame');
	PromptCard.Name = 'PromptCard';
	PromptCard.AnchorPoint = Vector2.new(0.5, 0.5);
	PromptCard.Position = UDim2.new(0.5, 0, 0.5, 0);
	PromptCard.Size = UDim2.new(1.0, 0, 1.0, 0);
	PromptCard.BackgroundColor3 = Color3.fromRGB(22, 14, 36);
	PromptCard.BackgroundTransparency = 0.12;
	PromptCard.Parent = PromptBillboard;

	local CardCorner: UICorner = Instance.new('UICorner');
	CardCorner.CornerRadius = UDim.new(0, 8);
	CardCorner.Parent = PromptCard;

	local CardStroke: UIStroke = Instance.new('UIStroke');
	CardStroke.Color = Color3.fromRGB(215, 115, 255);
	CardStroke.Thickness = 2.0;
	CardStroke.Parent = PromptCard;

	local PromptLabel: TextLabel = Instance.new('TextLabel');
	PromptLabel.Size = UDim2.new(1.0, -10, 1.0, 0);
	PromptLabel.Position = UDim2.new(0, 5, 0, 0);
	PromptLabel.BackgroundTransparency = 1.0;
	PromptLabel.Font = (Enum.Font.GothamBlack);
	PromptLabel.TextSize = 14;
	PromptLabel.TextColor3 = Color3.fromRGB(255, 225, 95);
	PromptLabel.TextStrokeColor3 = Color3.fromRGB(18, 10, 28);
	PromptLabel.TextStrokeTransparency = 0.1;
	PromptLabel.Text = '[Q] VANISH STRIKE!';
	PromptLabel.Parent = PromptCard;

	local CardScale: UIScale = Instance.new('UIScale');
	CardScale.Scale = 0.65;
	CardScale.Parent = PromptCard;

	local PopTween: Tween = TS:Create(CardScale, TweenInfo.new(0.14, (Enum.EasingStyle.Back), (Enum.EasingDirection.Out)), {
		Scale = 1.08,
	});
	PopTween:Play();

	ActiveVanishPromptGui = PromptBillboard;
	D:AddItem(PromptBillboard, PromptDuration);

	return;
end

---> Spawns a stylized 3D floating combat text callout (such as "PARRIED!", "GUARD BROKEN!", or "RAGE AWAKENED!").
local function SpawnCallout(TargetEntity: Instance, DisplayText: string, TextColor: Color3, BasePixelSize: number?): ()
	if not TargetEntity then return end

	local OriginPosition: Vector3? = ResolveIndicatorPosition(TargetEntity);

	if not OriginPosition then return end

	local AnchorPart: Part = Instance.new('Part');
	AnchorPart.Name = 'CombatCalloutAnchor';
	AnchorPart.Size = Vector3.new(0.5, 0.5, 0.5);
	AnchorPart.Transparency = 1.0;
	AnchorPart.CanCollide = false;
	AnchorPart.CanQuery = false;
	AnchorPart.CanTouch = false;
	AnchorPart.Massless = true;
	AnchorPart.Anchored = true;

	local RandomX: number = ((math.random(-20, 20)) / 10.0);
	local RandomZ: number = ((math.random(-20, 20)) / 10.0);
	local SpawnPosition: Vector3 = ((OriginPosition :: Vector3) + Vector3.new(RandomX, 2.6, RandomZ));
	AnchorPart.Position = SpawnPosition;
	AnchorPart.Parent = WS;

	local BillboardUI: BillboardGui = Instance.new('BillboardGui');
	BillboardUI.Name = 'CalloutBillboard';
	BillboardUI.Size = UDim2.new(6.0, 0, 2.2, 0);
	BillboardUI.AlwaysOnTop = true;
	BillboardUI.LightInfluence = 0.0;
	BillboardUI.Parent = AnchorPart;

	local CalloutLabel: TextLabel = Instance.new('TextLabel');
	CalloutLabel.Size = UDim2.new(1.0, 0, 1.0, 0);
	CalloutLabel.BackgroundTransparency = 1.0;
	CalloutLabel.Text = DisplayText;
	CalloutLabel.Font = (Enum.Font.GothamBlack);
	CalloutLabel.TextScaled = true;
	CalloutLabel.TextColor3 = TextColor;
	CalloutLabel.TextStrokeColor3 = Color3.fromRGB(10, 12, 18);
	CalloutLabel.TextStrokeTransparency = 0.1;
	CalloutLabel.Parent = BillboardUI;

	local ScaleScale: number = ((BasePixelSize or 28.0) / 28.0);
	local LabelScale: UIScale = Instance.new('UIScale');
	LabelScale.Scale = (0.4 * ScaleScale);
	LabelScale.Parent = CalloutLabel;

	local PopTweenInfo: TweenInfo = TweenInfo.new(0.18, (Enum.EasingStyle.Back), (Enum.EasingDirection.Out));
	local PopTween: Tween = TS:Create(LabelScale, PopTweenInfo, {
		Scale = (1.15 * ScaleScale),
	});
	PopTween:Play();

	local RiseTweenInfo: TweenInfo = TweenInfo.new(0.85, (Enum.EasingStyle.Quart), (Enum.EasingDirection.Out));
	local RiseTween: Tween = TS:Create(AnchorPart, RiseTweenInfo, {
		Position = (SpawnPosition + Vector3.new(0, 3.8, 0)),
	});
	RiseTween:Play();

	task.delay(0.35, function(): ()
		if not (CalloutLabel.Parent) then return end

		local FadeInfo: TweenInfo = TweenInfo.new(0.45, (Enum.EasingStyle.Quad), (Enum.EasingDirection.In));
		local FadeTween: Tween = TS:Create(CalloutLabel, FadeInfo, {
			TextTransparency       = 1.0,
			TextStrokeTransparency = 1.0,
		});
		FadeTween:Play();

		return;
	end);

	D:AddItem(AnchorPart, 0.9);

	return;
end

---> Spawns a floating numeric damage indicator on <TargetEntity>.
local function Spawn(TargetEntity: Instance, DamageAmount: number, IsCriticalOrHeavy: boolean?): ()
	local RoundedDamage: number = math.floor((DamageAmount + 0.5));
	local IsHeavy: boolean = (IsCriticalOrHeavy == true);
	local FormattedText: string = IsHeavy and `{RoundedDamage}!` or tostring(RoundedDamage);
	local ResolvedColor: Color3 = IsHeavy and Color3.fromRGB(255, 200, 65) or Color3.fromRGB(245, 248, 255);
	local ResolvedSize: number = IsHeavy and 34.0 or 26.0;

	SpawnCallout(TargetEntity, FormattedText, ResolvedColor, ResolvedSize);

	return;
end



local DamageIndicator: DamageIndicatorModule = {
	Spawn            = Spawn,
	SpawnCallout     = SpawnCallout,
	ShowVanishPrompt = ShowVanishPrompt,
	HideVanishPrompt = HideVanishPrompt,
};



return DamageIndicator;
