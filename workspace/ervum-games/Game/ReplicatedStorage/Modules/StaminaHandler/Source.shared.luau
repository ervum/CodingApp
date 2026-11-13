--!strict

local Players: Players = game:GetService('Players');
local ReplicatedStorage: ReplicatedStorage = game:GetService('ReplicatedStorage');
local RS: RunService = game:GetService('RunService');
local WS: Workspace = game:GetService('Workspace');

local ModulesFolder: Instance = ReplicatedStorage:WaitForChild('Modules');
local CombatTable = require(ModulesFolder:WaitForChild('CombatTable') :: ModuleScript);
local StateHandler = require(ModulesFolder:WaitForChild('StateHandler') :: ModuleScript);



export type StaminaHandlerModule = {
	Consume:          ((Instance, number) -> (boolean)),
	DrainContinuous:  ((Instance, number, number) -> (boolean)),
	ConsumePosture:   ((Instance, number) -> (boolean)),
	RestorePosture:   ((Instance, number) -> ()),
	AddRage:          ((Instance, number) -> ()),
	TryActivateRage:  ((Instance) -> (boolean)),
	UpdateEntityTick: ((Instance, number, number) -> ()),
};



---> Attempts to consume a discrete amount of Stamina from <Entity>, applying Rage cost reduction if active.
local function Consume(Entity: Instance, BaseAmount: number): (boolean)
	if not Entity then return false end

	local IsRageActive: boolean = StateHandler.GetBoolean(Entity, 'IsRageActive');
	local CostMultiplier: number = IsRageActive and (CombatTable.RageStaminaCostMultiplier) or 1.0;
	local EffectiveCost: number = (BaseAmount * CostMultiplier);
	local CurrentStamina: number = StateHandler.GetNumber(Entity, 'Stamina', (CombatTable.MaxStamina));

	if (CurrentStamina < EffectiveCost) then
		return false;
	end

	local NewStamina: number = math.max(0.0, (CurrentStamina - EffectiveCost));
	StateHandler.SetState(Entity, 'Stamina', NewStamina);
	StateHandler.SetState(Entity, 'LastStaminaUseTime', os.clock());

	return true;
end

---> Continuously drains Stamina over <DeltaTime> for sustained states like Climbing, Wall-Running, or Gliding.
local function DrainContinuous(Entity: Instance, DrainRatePerSecond: number, DeltaTime: number): (boolean)
	if not Entity then return false end

	local IsRageActive: boolean = StateHandler.GetBoolean(Entity, 'IsRageActive');
	local CostMultiplier: number = IsRageActive and (CombatTable.RageStaminaCostMultiplier) or 1.0;
	local FrameDrain: number = ((DrainRatePerSecond * CostMultiplier) * DeltaTime);
	local CurrentStamina: number = StateHandler.GetNumber(Entity, 'Stamina', (CombatTable.MaxStamina));

	if (CurrentStamina <= FrameDrain) then
		StateHandler.SetState(Entity, 'Stamina', 0.0);
		StateHandler.SetState(Entity, 'LastStaminaUseTime', os.clock());

		return false;
	end

	local NewStamina: number = (CurrentStamina - FrameDrain);
	StateHandler.SetState(Entity, 'Stamina', NewStamina);
	StateHandler.SetState(Entity, 'LastStaminaUseTime', os.clock());

	return true;
end

---> Applies Posture damage against a blocking <Entity>; returns false if Posture breaks (reaches 0).
local function ConsumePosture(Entity: Instance, PostureDamage: number): (boolean)
	if not Entity then return false end

	local CurrentPosture: number = StateHandler.GetNumber(Entity, 'Posture', (CombatTable.MaxPosture));
	local ScaledDrain: number = (PostureDamage * (CombatTable.BlockPostureDrainMultiplier));
	local RemainingPosture: number = (CurrentPosture - ScaledDrain);

	StateHandler.SetState(Entity, 'LastPostureHitTime', os.clock());

	if (RemainingPosture <= 0.0) then
		StateHandler.SetState(Entity, 'Posture', 0.0);

		return false;
	end

	StateHandler.SetState(Entity, 'Posture', RemainingPosture);

	return true;
end

---> Restores Posture on <Entity> (such as after landing a Timed Parry).
local function RestorePosture(Entity: Instance, RestoreAmount: number): ()
	if not Entity then return end

	local CurrentPosture: number = StateHandler.GetNumber(Entity, 'Posture', (CombatTable.MaxPosture));
	local MaxPosture: number = StateHandler.GetNumber(Entity, 'MaxPosture', (CombatTable.MaxPosture));
	local ClampedPosture: number = math.min(MaxPosture, (CurrentPosture + RestoreAmount));

	StateHandler.SetState(Entity, 'Posture', ClampedPosture);

	return;
end

---> Adds Rage meter points to <Entity> when dealing hits, taking damage, or parrying.
local function AddRage(Entity: Instance, GainAmount: number): ()
	if not Entity then return end
	if StateHandler.GetBoolean(Entity, 'IsRageActive') then return end

	local CurrentRage: number = StateHandler.GetNumber(Entity, 'Rage', 0.0);
	local MaxRage: number = StateHandler.GetNumber(Entity, 'MaxRage', (CombatTable.MaxRage));
	local ClampedRage: number = math.min(MaxRage, (CurrentRage + GainAmount));

	StateHandler.SetState(Entity, 'Rage', ClampedRage);

	return;
end

---> Attempts to trigger Rage Awakening if <Entity> has a full Rage bar.
local function TryActivateRage(Entity: Instance): (boolean)
	if not Entity then return false end
	if StateHandler.GetBoolean(Entity, 'IsRageActive') then return false end

	local CurrentRage: number = StateHandler.GetNumber(Entity, 'Rage', 0.0);
	local MaxRage: number = StateHandler.GetNumber(Entity, 'MaxRage', (CombatTable.MaxRage));

	if (CurrentRage < MaxRage) then
		return false;
	end

	StateHandler.SetState(Entity, 'IsRageActive', true);
	StateHandler.SetState(Entity, 'Stamina', (CombatTable.MaxStamina));
	StateHandler.SetState(Entity, 'Posture', (CombatTable.MaxPosture));

	return true;
end

---> Updates Stamina, Posture, and Rage for a single <Entity> on each server Heartbeat.
local function UpdateEntityTick(Entity: Instance, DeltaTime: number, CurrentClock: number): ()
	local IsClimbing: boolean = StateHandler.GetBoolean(Entity, 'IsClimbing');
	local IsWallRunning: boolean = StateHandler.GetBoolean(Entity, 'IsWallRunning');
	local IsGliding: boolean = StateHandler.GetBoolean(Entity, 'IsGliding');
	local IsDodging: boolean = StateHandler.GetBoolean(Entity, 'IsDodging');
	local IsAttacking: boolean = StateHandler.GetBoolean(Entity, 'IsAttacking');
	local IsBlocking: boolean = StateHandler.GetBoolean(Entity, 'IsBlocking');

	if not IsClimbing and not IsWallRunning and not IsGliding and not IsDodging and not IsAttacking then
		local CurrentStamina: number = StateHandler.GetNumber(Entity, 'Stamina', (CombatTable.MaxStamina));
		local MaxStamina: number = StateHandler.GetNumber(Entity, 'MaxStamina', (CombatTable.MaxStamina));
		local LastStaminaTime: number = StateHandler.GetNumber(Entity, 'LastStaminaUseTime', 0.0);

		if (CurrentStamina < MaxStamina) and ((CurrentClock - LastStaminaTime) >= (CombatTable.StaminaRegenDelay)) then
			local RegenStep: number = ((CombatTable.StaminaRegenRate) * DeltaTime);
			local NextStamina: number = math.min(MaxStamina, (CurrentStamina + RegenStep));
			StateHandler.SetState(Entity, 'Stamina', NextStamina);
		end
	end

	if not IsBlocking then
		local CurrentPosture: number = StateHandler.GetNumber(Entity, 'Posture', (CombatTable.MaxPosture));
		local MaxPosture: number = StateHandler.GetNumber(Entity, 'MaxPosture', (CombatTable.MaxPosture));
		local LastPostureTime: number = StateHandler.GetNumber(Entity, 'LastPostureHitTime', 0.0);

		if (CurrentPosture < MaxPosture) and ((CurrentClock - LastPostureTime) >= (CombatTable.PostureRegenDelay)) then
			local PostureStep: number = ((CombatTable.PostureRegenRate) * DeltaTime);
			local NextPosture: number = math.min(MaxPosture, (CurrentPosture + PostureStep));
			StateHandler.SetState(Entity, 'Posture', NextPosture);
		end
	end

	local IsRageActive: boolean = StateHandler.GetBoolean(Entity, 'IsRageActive');

	if IsRageActive then
		local CurrentRage: number = StateHandler.GetNumber(Entity, 'Rage', 0.0);
		local RageDrain: number = ((CombatTable.RageDrainRate) * DeltaTime);
		local RemainingRage: number = (CurrentRage - RageDrain);

		if (RemainingRage <= 0.0) then
			StateHandler.SetState(Entity, 'Rage', 0.0);
			StateHandler.SetState(Entity, 'IsRageActive', false);

			if Entity:IsA('Model') then
				local CharacterHumanoid: Humanoid? = Entity:FindFirstChildOfClass('Humanoid');

				if CharacterHumanoid and not StateHandler.GetBoolean(Entity, 'IsBlocking') and not StateHandler.GetBoolean(Entity, 'IsStunned') then
					CharacterHumanoid.WalkSpeed = (CombatTable.DefaultWalkSpeed);
				end
			end
		else
			StateHandler.SetState(Entity, 'Rage', RemainingRage);
		end
	end

	return;
end



if RS:IsServer() then
	RS.Heartbeat:Connect(function(DeltaTime: number): ()
		local CurrentClock: number = os.clock();

		for _: number, PlayerEntity: Player in Players:GetPlayers() do
			local PlayerCharacter: Model? = (PlayerEntity.Character);

			if PlayerCharacter then
				UpdateEntityTick(PlayerCharacter, DeltaTime, CurrentClock);
			end
		end

		local LiveFolder: Instance? = WS:FindFirstChild('Live');

		if LiveFolder then
			for _: number, LiveChild: Instance in LiveFolder:GetChildren() do
				if LiveChild:IsA('Model') and not Players:GetPlayerFromCharacter(LiveChild) then
					UpdateEntityTick(LiveChild, DeltaTime, CurrentClock);
				end
			end
		end

		return;
	end);
end



local StaminaHandler: StaminaHandlerModule = {
	Consume          = Consume,
	DrainContinuous  = DrainContinuous,
	ConsumePosture   = ConsumePosture,
	RestorePosture   = RestorePosture,
	AddRage          = AddRage,
	TryActivateRage  = TryActivateRage,
	UpdateEntityTick = UpdateEntityTick,
};



return StaminaHandler;
