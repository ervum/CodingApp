--!strict

local RS: RunService = game:GetService('RunService');
local WS: Workspace = game:GetService('Workspace');



export type HitCallback = ((Humanoid, BasePart) -> ());

export type HitboxSignal = {
	Connect: ((HitboxSignal, HitCallback) -> ()),
	Fire:    ((HitboxSignal, Humanoid, BasePart) -> ()),
};

export type HitboxObject = {
	BoxSize:         Vector3,
	Offset:          CFrame,
	CFrameSource:    BasePart?,
	OverlapFilter:   OverlapParams?,
	Visualizer:      boolean,
	AutoDestroy:     boolean,
	DetectionMode:   string,
	Touched:         HitboxSignal,
	HitParts:        HitboxSignal,
	Start:           ((HitboxObject) -> ()),
	Stop:            ((HitboxObject) -> ()),
	Destroy:         ((HitboxObject) -> ()),
};

export type MuchachoHitboxModule = {
	CreateHitbox: (() -> (HitboxObject)),
};



local function CreateSignal(): (HitboxSignal)
	local Listeners: { [number?]: HitCallback } = { };

	local SignalInstance: HitboxSignal = {
		Connect = function(_: HitboxSignal, Callback: HitCallback): ()
			table.insert(Listeners, Callback);

			return;
		end,
		Fire = function(_: HitboxSignal, TargetHumanoid: Humanoid, HitPart: BasePart): ()
			for _: number?, Listener: HitCallback in Listeners do
				task.spawn(Listener, TargetHumanoid, HitPart);
			end

			return;
		end,
	};

	return SignalInstance;
end

---> Creates a spatial <GetPartBoundsInBox> combat hitbox with optional debug wireframe visualization.
local function CreateHitbox(): (HitboxObject)
	local IsActive: boolean = false;
	local TouchedSignal: HitboxSignal = CreateSignal();
	local HitPartsSignal: HitboxSignal = CreateSignal();
	local HitHumanoidsMap: { [Humanoid?]: boolean } = { };
	local HeartbeatConnection: RBXScriptConnection? = nil;
	local VisualizerAdornment: BoxHandleAdornment? = nil;
	local VisualizerAnchor: Part? = nil;

	local Hitbox: HitboxObject = {
		BoxSize       = Vector3.new(5.0, 5.0, 5.0),
		Offset        = CFrame.new(0, 0, 0),
		CFrameSource  = nil,
		OverlapFilter = nil,
		Visualizer    = false,
		AutoDestroy   = true,
		DetectionMode = 'Default',
		Touched       = TouchedSignal,
		HitParts      = HitPartsSignal,
		Start         = function(_: HitboxObject): ()
			return;
		end,
		Stop          = function(_: HitboxObject): ()
			return;
		end,
		Destroy       = function(_: HitboxObject): ()
			return;
		end,
	};

	local function CleanupVisualizer(): ()
		if VisualizerAdornment then
			VisualizerAdornment:Destroy();
			VisualizerAdornment = nil;
		end

		if VisualizerAnchor then
			VisualizerAnchor:Destroy();
			VisualizerAnchor = nil;
		end

		return;
	end

	local function ResolveWorldCFrame(): (CFrame)
		local SourcePart: BasePart? = (Hitbox.CFrameSource);

		if SourcePart then
			local BaseCFrame: CFrame = (SourcePart.CFrame);
			local CombinedCFrame: CFrame = (BaseCFrame * (Hitbox.Offset));

			return CombinedCFrame;
		end

		return (Hitbox.Offset);
	end

	local function PerformSpatialStep(): ()
		local BoxCFrame: CFrame = ResolveWorldCFrame();
		local BoxDimensions: Vector3 = (Hitbox.BoxSize);
		local FilterParams: OverlapParams = (Hitbox.OverlapFilter) or OverlapParams.new();

		if (Hitbox.Visualizer) then
			if not VisualizerAnchor then
				local NewAnchor: Part = Instance.new('Part');
				NewAnchor.Name = 'HitboxVisualizerAnchor';
				NewAnchor.Anchored = true;
				NewAnchor.CanCollide = false;
				NewAnchor.CanQuery = false;
				NewAnchor.CanTouch = false;
				NewAnchor.Transparency = 1.0;
				NewAnchor.Size = Vector3.new(0.1, 0.1, 0.1);
				NewAnchor.Parent = WS.Terrain;

				local NewBox: BoxHandleAdornment = Instance.new('BoxHandleAdornment');
				NewBox.Name = 'HitboxDebugBox';
				NewBox.Adornee = NewAnchor;
				NewBox.Color3 = Color3.fromRGB(255, 55, 75);
				NewBox.Transparency = 0.65;
				NewBox.ZIndex = 2;
				NewBox.AlwaysOnTop = false;
				NewBox.Parent = NewAnchor;

				VisualizerAnchor = NewAnchor;
				VisualizerAdornment = NewBox;
			end

			if VisualizerAdornment then
				VisualizerAdornment.CFrame = BoxCFrame;
				VisualizerAdornment.Size = BoxDimensions;
			end
		end

		local OverlappingParts: { [number?]: BasePart } = WS:GetPartBoundsInBox(BoxCFrame, BoxDimensions, FilterParams);

		for _: number?, CandidatePart: BasePart in OverlappingParts do
			local ParentModel: Instance? = (CandidatePart.Parent);

			if not ParentModel then continue end

			local CandidateHumanoid: Humanoid? = ParentModel:FindFirstChildOfClass('Humanoid');

			if CandidateHumanoid and ((CandidateHumanoid.Health) > 0) then
				if (Hitbox.DetectionMode == 'Default') then
					if not HitHumanoidsMap[CandidateHumanoid] then
						HitHumanoidsMap[CandidateHumanoid] = true;
						TouchedSignal:Fire(CandidateHumanoid, CandidatePart);
					end
				elseif (Hitbox.DetectionMode == 'HitOnce') then
					HitHumanoidsMap[CandidateHumanoid] = true;
					TouchedSignal:Fire(CandidateHumanoid, CandidatePart);
					Hitbox:Stop();

					break;
				elseif (Hitbox.DetectionMode == 'ConstantDetection') then
					TouchedSignal:Fire(CandidateHumanoid, CandidatePart);
				end
			elseif (Hitbox.DetectionMode == 'HitParts') then
				local DummyHumanoid: Humanoid? = ParentModel:FindFirstChildOfClass('Humanoid');

				if DummyHumanoid then
					HitPartsSignal:Fire(DummyHumanoid, CandidatePart);
				end
			end
		end

		return;
	end

	local function StartHitbox(_: HitboxObject): ()
		if IsActive then return end

		IsActive = true;
		table.clear(HitHumanoidsMap);

		PerformSpatialStep();

		HeartbeatConnection = RS.Heartbeat:Connect(function(_: number): ()
			if not IsActive then return end

			PerformSpatialStep();

			return;
		end);

		return;
	end

	local function StopHitbox(_: HitboxObject): ()
		if not IsActive then return end

		IsActive = false;

		if HeartbeatConnection then
			HeartbeatConnection:Disconnect();
			HeartbeatConnection = nil;
		end

		CleanupVisualizer();

		return;
	end

	local function DestroyHitbox(SelfHitbox: HitboxObject): ()
		SelfHitbox:Stop();
		table.clear(HitHumanoidsMap);

		return;
	end

	Hitbox.Start = StartHitbox;
	Hitbox.Stop = StopHitbox;
	Hitbox.Destroy = DestroyHitbox;

	return Hitbox;
end



local MuchachoHitbox: MuchachoHitboxModule = {
	CreateHitbox = CreateHitbox,
};



return MuchachoHitbox;
