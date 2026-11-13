--!strict

local ReplicatedStorage: ReplicatedStorage = game:GetService('ReplicatedStorage');
local WS: Workspace = game:GetService('Workspace');

local ModulesFolder: Instance = ReplicatedStorage:WaitForChild('Modules');

local AnimationHandler = require(ModulesFolder:WaitForChild('AnimationHandler') :: ModuleScript);
local AnimationRegistry = require(ModulesFolder:WaitForChild('AnimationRegistry') :: ModuleScript);
local CombatTable = require(ModulesFolder:WaitForChild('CombatTable') :: ModuleScript);
local CombatTypes = require(ModulesFolder:WaitForChild('CombatTypes') :: ModuleScript);
local HitService = require(ModulesFolder:WaitForChild('HitService') :: ModuleScript);
local MuchachoHitbox = require(ModulesFolder:WaitForChild('MuchachoHitbox') :: ModuleScript);
local PhysicsImpulse = require(ModulesFolder:WaitForChild('PhysicsImpulse') :: ModuleScript);
local SoundHandler = require(ModulesFolder:WaitForChild('SoundHandler') :: ModuleScript);
local StaminaHandler = require(ModulesFolder:WaitForChild('StaminaHandler') :: ModuleScript);
local StateHandler = require(ModulesFolder:WaitForChild('StateHandler') :: ModuleScript);
local WeaponConfig = require(ModulesFolder:WaitForChild('WeaponConfig') :: ModuleScript);
local WeaponHandler = require(ModulesFolder:WaitForChild('WeaponHandler') :: ModuleScript);



export type AttackStepDescriptor = CombatTypes.AttackStepDescriptor;
export type VFXPayload = CombatTypes.VFXPayload;
export type WeaponDescriptor = CombatTypes.WeaponDescriptor;

export type CombatManagerModule = {
	ExecuteCharacterCombo: ((Model) -> (boolean)),
	LightAttack: ((Player) -> ()),
	HeavyAttack: ((Player) -> ()),
	AirSlam: ((Player) -> ()),
	Block: ((Player, boolean) -> ()),
	Dash: ((Player, Vector3?, string?) -> ()),
	ActivateRage: ((Player) -> ()),
	SwitchWeapon: ((Player, string) -> ()),
};



local ComboResetTokens: { [Model?]: number } = { };
local HeavyCooldownMap: { [Model?]: number } = { };
local DashCooldownMap: { [Model?]: number } = { };
local AirSlamCooldownMap: { [Model?]: number } = { };



local function BroadcastVFX(EffectName: string, Payload: VFXPayload): ()
	local RemoteFolder: Instance? = ReplicatedStorage:FindFirstChild('RemoteEvents');
	local VFXRemote: RemoteEvent? = RemoteFolder and (RemoteFolder:FindFirstChild('VFXReplication') :: RemoteEvent?) or nil;

	if VFXRemote then
		VFXRemote:FireAllClients(EffectName, Payload);
	end

	return;
end

local function ResolveComboAnimationID(StyleName: string, ComboStep: number): (string)
	local StyleTable: { [number?]: string } = (AnimationRegistry.Fists);

	if (StyleName == 'Sword') then
		StyleTable = (AnimationRegistry.Sword);
	elseif (StyleName == 'Katana') then
		StyleTable = (AnimationRegistry.Katana);
	elseif (StyleName == 'Spear') then
		StyleTable = (AnimationRegistry.Spear);
	elseif (StyleName == 'Bow') then
		StyleTable = (AnimationRegistry.Bow);
	end

	local AnimationID: string = StyleTable[ComboStep] or (AnimationRegistry.Fists[1] :: string);

	return AnimationID;
end

---> Executes a skillset-driven M1 combo step on any <Character> (used by both Players and AI Gladiators).
local function ExecuteCharacterCombo(Character: Model): (boolean)
	if not Character then return false end

	local RootPart: BasePart? = (Character:FindFirstChild('HumanoidRootPart') :: BasePart?);
	local Humanoid: Humanoid? = Character:FindFirstChildOfClass('Humanoid');

	if not RootPart or not Humanoid or ((Humanoid.Health) <= 0) then
		return false;
	end

	if not StateHandler.CanAct(Character) then
		return false;
	end

	local EquippedWeaponName: string = StateHandler.GetString(Character, 'EquippedWeapon', 'Fists');
	local CurrentCombo: number = math.clamp(StateHandler.GetNumber(Character, 'Combo', 1), 1, (CombatTable.MaxCombo));
	local StepKey: string = tostring(CurrentCombo);
	local StepEnvelope: AttackStepDescriptor = WeaponConfig.GetAttackEnvelope(EquippedWeaponName, StepKey);

	StateHandler.SetState(Character, 'IsAttacking', true);

	local NextToken: number = ((ComboResetTokens[Character] or 0) + 1);
	ComboResetTokens[Character] = NextToken;

	local AnimID: string = ResolveComboAnimationID(EquippedWeaponName, CurrentCombo);
	local AnimSpeed: number = StateHandler.GetBoolean(Character, 'IsRageActive') and 1.18 or 1.0;
	AnimationHandler.PlayAnimation(Character, AnimID, (Enum.AnimationPriority.Action), AnimSpeed, Combo{CurrentCombo});

	BroadcastVFX('Slash', {
		Attacker = Character,
		WeaponName = EquippedWeaponName,
		ComboStep = CurrentCombo,
		IsHeavy = (CurrentCombo == (CombatTable.MaxCombo)),
	});

	local ForwardStepSpeed: number = (CurrentCombo == (CombatTable.MaxCombo)) and 22.0 or 10.0;
	PhysicsImpulse.ApplyImpulse(RootPart, (((RootPart.CFrame.LookVector).Unit) * ForwardStepSpeed), 0.1);

	task.spawn(function(): ()
		task.wait(StepEnvelope.HitboxDelay);

		if not StateHandler.GetBoolean(Character, 'IsAttacking') or StateHandler.GetBoolean(Character, 'IsStunned') then
			return;
		end

		local FilterParams: OverlapParams = OverlapParams.new();
		FilterParams.FilterType = (Enum.RaycastFilterType.Exclude);
		FilterParams.FilterDescendantsInstances = { Character };

		local ActiveHitbox = MuchachoHitbox.CreateHitbox();
		ActiveHitbox.BoxSize = (StepEnvelope.HitboxSize);
		ActiveHitbox.Offset = (StepEnvelope.HitboxOffset);
		ActiveHitbox.CFrameSource = RootPart;
		ActiveHitbox.OverlapFilter = FilterParams;
		ActiveHitbox.Visualizer = false;

		local HitVictimsMap: { [Model?]: boolean } = { };

		ActiveHitbox.Touched:Connect(function(TargetHumanoid: Humanoid, _: BasePart): ()
			local VictimModel: Instance? = (TargetHumanoid.Parent);

			if VictimModel and VictimModel:IsA('Model') and not HitVictimsMap[VictimModel] then
				HitVictimsMap[VictimModel] = true;
				HitService.ProcessEnvelopeHit(Character, VictimModel, StepEnvelope, (CurrentCombo == (CombatTable.MaxCombo)));
			end

			return;
		end);

		ActiveHitbox:Start();

		local LiveFolder: Instance? = WS:FindFirstChild('Live');
		local SearchContainers: { [number]: Instance } = LiveFolder and { LiveFolder, WS } or { WS };
		local ProximityRange: number = math.max(9.0, (StepEnvelope.HitboxSize.Z + 2.5));

		for _: number, Container: Instance in SearchContainers do
			for _: number, CandidateObj: Instance in Container:GetChildren() do
				if CandidateObj:IsA('Model') and (CandidateObj ~= Character) and not HitVictimsMap[CandidateObj] then
					local CandidateHum: Humanoid? = CandidateObj:FindFirstChildOfClass('Humanoid');
					local CandidateRoot: BasePart? = (CandidateObj:FindFirstChild('HumanoidRootPart') :: BasePart?) or (CandidateObj.PrimaryPart);

					if CandidateHum and CandidateRoot and ((CandidateHum.Health) > 0) then
						local OffsetVec: Vector3 = ((CandidateRoot.Position) - (RootPart.Position));
						local Distance: number = (OffsetVec.Magnitude);

						if (Distance <= ProximityRange) then
							local PlanarOffset: Vector3 = Vector3.new((OffsetVec.X), 0.0, (OffsetVec.Z));
							local FacingDot: number = ((PlanarOffset.Magnitude) > 0.05) and ((PlanarOffset.Unit):Dot(Vector3.new((RootPart.CFrame.LookVector.X), 0.0, (RootPart.CFrame.LookVector.Z)).Unit)) or 1.0;

							if (Distance <= 6.5) or (FacingDot >= -0.15) then
								HitVictimsMap[CandidateObj] = true;
								HitService.ProcessEnvelopeHit(Character, CandidateObj, StepEnvelope, (CurrentCombo == (CombatTable.MaxCombo)));
							end
						end
					end
				end
			end
		end

		task.wait(StepEnvelope.HitboxDuration);
		ActiveHitbox:Stop();

		task.wait(StepEnvelope.RecoveryDuration);

		if (ComboResetTokens[Character] == NextToken) then
			local NextComboStep: number = (CurrentCombo >= (CombatTable.MaxCombo)) and 1 or (CurrentCombo + 1);
			StateHandler.SetState(Character, 'Combo', NextComboStep);
			StateHandler.SetState(Character, 'IsAttacking', false);

			task.delay((CombatTable.ComboResetTime), function(): ()
				if (ComboResetTokens[Character] == NextToken) and not StateHandler.GetBoolean(Character, 'IsAttacking') then
					StateHandler.SetState(Character, 'Combo', 1);
				end

				return;
			end);
		end

		return;
	end);

	return true;
end

---> Initiates an M1 Light Attack combo step (or Flash-Step Vanish Follow-Up) for <Player>.
local function LightAttack(Player: Player): ()
	local Character: Model? = (Player.Character);

	if not Character then return end

	if HitService.TryExecuteVanishFollowUp(Character) then
		return;
	end

	ExecuteCharacterCombo(Character);

	return;
end

---> Initiates a Guard-Breaking Heavy Attack (R) for <Player>.
local function HeavyAttack(Player: Player): ()
	local Character: Model? = (Player.Character);

	if not Character then return end

	local RootPart: BasePart? = (Character:FindFirstChild('HumanoidRootPart') :: BasePart?);

	if not RootPart or not StateHandler.CanAct(Character) then return end

	local EquippedWeaponName: string = StateHandler.GetString(Character, 'EquippedWeapon', 'Fists');
	local WeaponData: WeaponDescriptor = WeaponConfig.GetWeapon(EquippedWeaponName);
	local HeavyEnvelope: AttackStepDescriptor = WeaponConfig.GetAttackEnvelope(EquippedWeaponName, 'Heavy');

	local CurrentTime: number = os.clock();
	local LastHeavyTime: number = (HeavyCooldownMap[Character] or 0.0);

	if ((CurrentTime - LastHeavyTime) < (WeaponData.HeavyCooldown)) then
		return;
	end

	if not StaminaHandler.Consume(Character, 18.0) then
		return;
	end

	HeavyCooldownMap[Character] = CurrentTime;
	StateHandler.SetState(Character, 'IsAttacking', true);

	local NextToken: number = ((ComboResetTokens[Character] or 0) + 1);
	ComboResetTokens[Character] = NextToken;

	AnimationHandler.PlayAnimation(Character, (AnimationRegistry.HeavyAttack), (Enum.AnimationPriority.Action2), 1.0);

	BroadcastVFX('Slash', {
		Attacker = Character,
		WeaponName = EquippedWeaponName,
		IsHeavy = true,
	});

	task.spawn(function(): ()
		task.wait(HeavyEnvelope.HitboxDelay);

		if not StateHandler.GetBoolean(Character, 'IsAttacking') or StateHandler.GetBoolean(Character, 'IsStunned') then
			return;
		end

		PhysicsImpulse.ApplyImpulse(RootPart, (((RootPart.CFrame.LookVector).Unit) * 34.0), 0.16);

		local FilterParams: OverlapParams = OverlapParams.new();
		FilterParams.FilterType = (Enum.RaycastFilterType.Exclude);
		FilterParams.FilterDescendantsInstances = { Character };

		local ActiveHitbox = MuchachoHitbox.CreateHitbox();
		ActiveHitbox.BoxSize = (HeavyEnvelope.HitboxSize);
		ActiveHitbox.Offset = (HeavyEnvelope.HitboxOffset);
		ActiveHitbox.CFrameSource = RootPart;
		ActiveHitbox.OverlapFilter = FilterParams;
		ActiveHitbox.Visualizer = false;

		ActiveHitbox.Touched:Connect(function(TargetHumanoid: Humanoid, _: BasePart): ()
			local VictimModel: Instance? = (TargetHumanoid.Parent);

			if VictimModel and VictimModel:IsA('Model') then
				HitService.ProcessEnvelopeHit(Character, VictimModel, HeavyEnvelope, true);
			end

			return;
		end);

		ActiveHitbox:Start();
		task.wait(HeavyEnvelope.HitboxDuration);
		ActiveHitbox:Stop();

		task.wait(HeavyEnvelope.RecoveryDuration);

		StateHandler.SetState(Character, 'Combo', 1);
		StateHandler.SetState(Character, 'IsAttacking', false);

		return;
	end);

	return;
end

---> Initiates an aerial downward slam (Space + M1) that creates an explosion shockwave upon ground impact.
local function AirSlam(Player: Player): ()
	local Character: Model? = (Player.Character);

	if not Character then return end

	local RootPart: BasePart? = (Character:FindFirstChild('HumanoidRootPart') :: BasePart?);
	local Humanoid: Humanoid? = Character:FindFirstChildOfClass('Humanoid');

	if not RootPart or not Humanoid or not StateHandler.CanAct(Character) then return end

	local CurrentTime: number = os.clock();
	local LastSlamTime: number = (AirSlamCooldownMap[Character] or 0.0);

	if ((CurrentTime - LastSlamTime) < (CombatTable.AirSlamCooldown)) then
		return;
	end

	local GroundCheckParams: RaycastParams = RaycastParams.new();
	GroundCheckParams.FilterType = (Enum.RaycastFilterType.Exclude);
	GroundCheckParams.FilterDescendantsInstances = { Character };

	local NearGroundRay: RaycastResult? = WS:Raycast((RootPart.Position), Vector3.new(0.0, (-((CombatTable.AirSlamMinHeight))), 0.0), GroundCheckParams);

	if NearGroundRay then return end

	if not StaminaHandler.Consume(Character, (CombatTable.AirSlamCost)) then
		return;
	end

	AirSlamCooldownMap[Character] = CurrentTime;
	StateHandler.SetState(Character, 'IsAttacking', true);

	AnimationHandler.PlayAnimation(Character, (AnimationRegistry.AirSlam), (Enum.AnimationPriority.Action3), 1.15);

	local PlungeMover = PhysicsImpulse.CreatePersistentMover(RootPart, 'AirSlamPlungeMover', Vector3.new(0.0, (CombatTable.AirSlamDescentSpeed), 0.0), Vector3.new(95000, 95000, 95000));

	task.spawn(function(): ()
		local PlungeStart: number = os.clock();

		while ((os.clock() - PlungeStart) < 1.6) do
			if not (Character.Parent) or StateHandler.GetBoolean(Character, 'IsStunned') then
				break;
			end

			local ImpactRay: RaycastResult? = WS:Raycast((RootPart.Position), Vector3.new(0.0, -4.8, 0.0), GroundCheckParams);

			if ImpactRay then
				break;
			end

			task.wait(0.03);
		end

		PlungeMover.Destroy();

		if not (Character.Parent) or StateHandler.GetBoolean(Character, 'IsStunned') then
			StateHandler.SetState(Character, 'IsAttacking', false);

			return;
		end

		local SlamDiameter: number = ((CombatTable.AirSlamRadius) * 2.0);
		local SlamEnvelope: AttackStepDescriptor = {
			Damage = (CombatTable.AirSlamDamage),
			PostureDamage = (CombatTable.AirSlamPostureDamage),
			HitboxDelay = 0.0,
			HitboxDuration = 0.16,
			RecoveryDuration = 0.25,
			HitboxSize = Vector3.new(SlamDiameter, 10.0, SlamDiameter),
			HitboxOffset = CFrame.new(0.0, -1.5, 0.0),
			KnockbackSpeed = 55.0,
			StunDuration = 1.25,
			GuardBreak = true,
			CausesRagdoll = true,
		};

		BroadcastVFX('AirSlamImpact', {
			Attacker = Character,
			Position = ((RootPart.Position) - Vector3.new(0.0, 2.6, 0.0)),
			IsHeavy = true,
		});

		local FilterParams: OverlapParams = OverlapParams.new();
		FilterParams.FilterType = (Enum.RaycastFilterType.Exclude);
		FilterParams.FilterDescendantsInstances = { Character };

		local SlamHitbox = MuchachoHitbox.CreateHitbox();
		SlamHitbox.BoxSize = (SlamEnvelope.HitboxSize);
		SlamHitbox.Offset = (SlamEnvelope.HitboxOffset);
		SlamHitbox.CFrameSource = RootPart;
		SlamHitbox.OverlapFilter = FilterParams;

		SlamHitbox.Touched:Connect(function(TargetHumanoid: Humanoid, _: BasePart): ()
			local VictimModel: Instance? = (TargetHumanoid.Parent);

			if VictimModel and VictimModel:IsA('Model') then
				HitService.ProcessEnvelopeHit(Character, VictimModel, SlamEnvelope, true);
			end

			return;
		end);

		SlamHitbox:Start();
		task.wait(SlamEnvelope.HitboxDuration);
		SlamHitbox:Stop();

		task.wait(SlamEnvelope.RecoveryDuration);
		StateHandler.SetState(Character, 'IsAttacking', false);

		return;
	end);

	return;
end

---> Toggles directional blocking (F) and opens a Timed Parry window if ParryFailCooldown has elapsed.
local function Block(Player: Player, ShouldBlock: boolean): ()
	local Character: Model? = (Player.Character);

	if not Character then return end

	local Humanoid: Humanoid? = Character:FindFirstChildOfClass('Humanoid');

	if not Humanoid or ((Humanoid.Health) <= 0) then return end

	if ShouldBlock then
		if not StateHandler.CanAct(Character) then return end

		local CurrentPosture: number = StateHandler.GetNumber(Character, 'Posture', (CombatTable.MaxPosture));

		if (CurrentPosture <= 2.0) then return end

		StateHandler.SetState(Character, 'IsBlocking', true);
		Humanoid.WalkSpeed = (CombatTable.BlockWalkSpeed);

		AnimationHandler.PlayAnimation(Character, (AnimationRegistry.Block), (Enum.AnimationPriority.Action), 1.0);

		local CurrentClock: number = os.clock();
		local LastParryTime: number = StateHandler.GetNumber(Character, 'LastParryAttemptTime', 0.0);

		if ((CurrentClock - LastParryTime) >= (CombatTable.ParryFailCooldown)) then
			StateHandler.SetState(Character, 'LastParryAttemptTime', CurrentClock);
			StateHandler.SetState(Character, 'IsParrying', true);

			task.delay((CombatTable.ParryWindow), function(): ()
				if (Character.Parent) and StateHandler.GetBoolean(Character, 'IsParrying') then
					StateHandler.SetState(Character, 'IsParrying', false);
				end

				return;
			end);
		end
	else
		if not StateHandler.GetBoolean(Character, 'IsBlocking') then return end

		StateHandler.SetState(Character, 'IsBlocking', false);
		StateHandler.SetState(Character, 'IsParrying', false);

		AnimationHandler.StopAnimation(Character, (AnimationRegistry.Block), 0.12);

		if not StateHandler.GetBoolean(Character, 'IsStunned') and not StateHandler.GetBoolean(Character, 'IsRagdolled') then
			local IsRageActive: boolean = StateHandler.GetBoolean(Character, 'IsRageActive');
			Humanoid.WalkSpeed = IsRageActive and (CombatTable.RageWalkSpeed) or (CombatTable.DefaultWalkSpeed);
		end
	end

	return;
end

---> Executes an 8-way directional Dash (Q) with temporary Invulnerability Frames (IsDodging) or a Vanish Follow-Up.
local function Dash(Player: Player, RequestedDirection: Vector3?, DashKeyName: string?): ()
	local Character: Model? = (Player.Character);

	if not Character then return end

	if HitService.TryExecuteVanishFollowUp(Character) then
		return;
	end

	local RootPart: BasePart? = (Character:FindFirstChild('HumanoidRootPart') :: BasePart?);
	local Humanoid: Humanoid? = Character:FindFirstChildOfClass('Humanoid');

	if not RootPart or not Humanoid or ((Humanoid.Health) <= 0) then return end

	if not StateHandler.CanMoveFreely(Character) or StateHandler.GetBoolean(Character, 'IsDodging') then
		return;
	end

	local CurrentClock: number = os.clock();
	local LastDashClock: number = (DashCooldownMap[Character] or 0.0);

	if ((CurrentClock - LastDashClock) < (CombatTable.DashCooldown)) then
		return;
	end

	if not StaminaHandler.Consume(Character, (CombatTable.DashCost)) then
		return;
	end

	DashCooldownMap[Character] = CurrentClock;

	if StateHandler.GetBoolean(Character, 'IsBlocking') then
		StateHandler.SetState(Character, 'IsBlocking', false);
		StateHandler.SetState(Character, 'IsParrying', false);
		AnimationHandler.StopAnimation(Character, (AnimationRegistry.Block), 0.08);
	end

	StateHandler.SetState(Character, 'IsDodging', true);

	local DashDirection: Vector3 = ((RootPart.CFrame.LookVector).Unit);

	if RequestedDirection and (typeof(RequestedDirection) == 'Vector3') and ((RequestedDirection.X) == (RequestedDirection.X)) and ((RequestedDirection.Y) == (RequestedDirection.Y)) and ((RequestedDirection.Z) == (RequestedDirection.Z)) and ((RequestedDirection.Magnitude) > 0.05) then
		local PlanarDir: Vector3 = Vector3.new((RequestedDirection.X), 0.0, (RequestedDirection.Z));

		if ((PlanarDir.Magnitude) > 0.05) then
			DashDirection = (PlanarDir.Unit);
		end
	end

	local ResolvedKey: string = DashKeyName or 'Forward';
	local DashAnimID: string = (AnimationRegistry.Dash[ResolvedKey]) or (AnimationRegistry.Dash['Forward'] :: string);
	AnimationHandler.PlayAnimation(Character, DashAnimID, (Enum.AnimationPriority.Action2), 1.25);

	PhysicsImpulse.ApplyImpulse(RootPart, (DashDirection * (CombatTable.DashSpeed)), (CombatTable.DashDuration), Vector3.new(90000, 0, 90000));

	BroadcastVFX('Dash', {
		Attacker = Character,
		Direction = DashDirection,
	});

	task.delay((CombatTable.DashDuration), function(): ()
		if (Character.Parent) then
			StateHandler.SetState(Character, 'IsDodging', false);
		end

		return;
	end);

	return;
end

---> Triggers Rage Awakening (G) when the player's Rage bar is full, activating AURAS / RAGE SPELL and buffing speed and damage.
local function ActivateRage(Player: Player): ()
	local Character: Model? = (Player.Character);

	if not Character then return end

	local RootPart: BasePart? = (Character:FindFirstChild('HumanoidRootPart') :: BasePart?);
	local Humanoid: Humanoid? = Character:FindFirstChildOfClass('Humanoid');

	if not RootPart or not Humanoid or ((Humanoid.Health) <= 0) then return end

	if not StaminaHandler.TryActivateRage(Character) then
		return;
	end

	AnimationHandler.PlayAnimation(Character, (AnimationRegistry.RageAwaken), (Enum.AnimationPriority.Action3), 1.1);

	if not StateHandler.GetBoolean(Character, 'IsBlocking') and not StateHandler.GetBoolean(Character, 'IsStunned') then
		Humanoid.WalkSpeed = (CombatTable.RageWalkSpeed);
	end

	BroadcastVFX('RageAwaken', {
		Attacker = Character,
		Position = (RootPart.Position),
	});

	return;
end

---> Switches the player's active combat weapon style (Fists, Sword, Katana, Spear, Bow).
local function SwitchWeapon(Player: Player, RequestedWeaponName: string): ()
	local Character: Model? = (Player.Character);

	if not Character then return end
	if not StateHandler.CanAct(Character) then return end

	if (WeaponConfig.Weapons[RequestedWeaponName] == nil) then
		return;
	end

	WeaponHandler.EquipWeapon(Character, RequestedWeaponName);

	return;
end



local CombatManager: CombatManagerModule = {
	ExecuteCharacterCombo = ExecuteCharacterCombo,
	LightAttack = LightAttack,
	HeavyAttack = HeavyAttack,
	AirSlam = AirSlam,
	Block = Block,
	Dash = Dash,
	ActivateRage = ActivateRage,
	SwitchWeapon = SwitchWeapon,
};



return CombatManager;
