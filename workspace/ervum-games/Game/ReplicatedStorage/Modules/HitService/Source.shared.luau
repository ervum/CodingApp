--!strict

local ReplicatedStorage: ReplicatedStorage = game:GetService('ReplicatedStorage');
local ModulesFolder: Instance = ReplicatedStorage:WaitForChild('Modules');

local AnimationHandler = require(ModulesFolder:WaitForChild('AnimationHandler') :: ModuleScript);
local AnimationRegistry = require(ModulesFolder:WaitForChild('AnimationRegistry') :: ModuleScript);
local CombatTable = require(ModulesFolder:WaitForChild('CombatTable') :: ModuleScript);
local CombatTypes = require(ModulesFolder:WaitForChild('CombatTypes') :: ModuleScript);
local PhysicsImpulse = require(ModulesFolder:WaitForChild('PhysicsImpulse') :: ModuleScript);
local RagdollHandler = require(ModulesFolder:WaitForChild('RagdollHandler') :: ModuleScript);
local SoundHandler = require(ModulesFolder:WaitForChild('SoundHandler') :: ModuleScript);
local StaminaHandler = require(ModulesFolder:WaitForChild('StaminaHandler') :: ModuleScript);
local StateHandler = require(ModulesFolder:WaitForChild('StateHandler') :: ModuleScript);
local StunHandler = require(ModulesFolder:WaitForChild('StunHandler') :: ModuleScript);



export type AttackStepDescriptor = CombatTypes.AttackStepDescriptor;
export type VFXPayload = CombatTypes.VFXPayload;

export type HitServiceModule = {
	ProcessEnvelopeHit:       ((Model, Model, AttackStepDescriptor, boolean?) -> (string)),
	TryExecuteVanishFollowUp: ((Model) -> (boolean)),
};



local VanishTargetMap: { [Model?]: Model } = { };
local VanishWindowExpiryMap: { [Model?]: number } = { };



local function GetVFXRemote(): (RemoteEvent?)
	local RemoteFolder: Instance? = ReplicatedStorage:FindFirstChild('RemoteEvents');

	if not RemoteFolder then return nil end

	local VFXRemote: RemoteEvent? = (RemoteFolder:FindFirstChild('VFXReplication') :: RemoteEvent?);

	return VFXRemote;
end

local function BroadcastVFX(EffectName: string, Payload: VFXPayload): ()
	local VFXRemote: RemoteEvent? = GetVFXRemote();

	if VFXRemote then
		VFXRemote:FireAllClients(EffectName, Payload);
	end

	return;
end

local function OpenVanishWindow(Attacker: Model, Victim: Model): ()
	local WindowDuration: number = (CombatTable.VanishWindowDuration);
	local ExpiryClock: number = (os.clock() + WindowDuration);

	VanishTargetMap[Attacker] = Victim;
	VanishWindowExpiryMap[Attacker] = ExpiryClock;
	StateHandler.SetState(Attacker, 'CanVanishFollowUp', true);

	task.delay(WindowDuration, function(): ()
		if ((VanishWindowExpiryMap[Attacker] or 0.0) <= os.clock()) then
			VanishTargetMap[Attacker] = nil;
			VanishWindowExpiryMap[Attacker] = nil;

			if (Attacker.Parent) then
				StateHandler.SetState(Attacker, 'CanVanishFollowUp', false);
			end
		end

		return;
	end);

	return;
end

---> Executes a Flash-Step / Vanish Chase follow-up behind a launched enemy if within the active `VanishWindowDuration`.
local function TryExecuteVanishFollowUp(Attacker: Model): (boolean)
	if not Attacker then return false end

	local ExpiryClock: number? = VanishWindowExpiryMap[Attacker];
	local TargetVictim: Model? = VanishTargetMap[Attacker];

	if not ExpiryClock or not TargetVictim or (os.clock() > ExpiryClock) then
		return false;
	end

	VanishWindowExpiryMap[Attacker] = nil;
	VanishTargetMap[Attacker] = nil;
	StateHandler.SetState(Attacker, 'CanVanishFollowUp', false);

	if StateHandler.GetBoolean(Attacker, 'IsStunned') or StateHandler.GetBoolean(Attacker, 'IsRagdolled') then
		return false;
	end

	local AttackerHumanoid: Humanoid? = Attacker:FindFirstChildOfClass('Humanoid');
	local AttackerRoot: BasePart? = (Attacker:FindFirstChild('HumanoidRootPart') :: BasePart?);
	local VictimHumanoid: Humanoid? = TargetVictim:FindFirstChildOfClass('Humanoid');
	local VictimRoot: BasePart? = (TargetVictim:FindFirstChild('HumanoidRootPart') :: BasePart?);

	if not AttackerHumanoid or not AttackerRoot or not VictimHumanoid or not VictimRoot then
		return false;
	end

	if ((AttackerHumanoid.Health) <= 0) or ((VictimHumanoid.Health) <= 0) then
		return false;
	end

	local SeparationDistance: number = (((VictimRoot.Position) - (AttackerRoot.Position)).Magnitude);

	if (SeparationDistance > (CombatTable.VanishMaxDistance)) then
		return false;
	end

	if not StaminaHandler.Consume(Attacker, (CombatTable.VanishStaminaCost)) then
		return false;
	end

	local OriginPosition: Vector3 = (AttackerRoot.Position);
	local VictimPos: Vector3 = (VictimRoot.Position);
	local ApproachDir: Vector3 = (VictimPos - OriginPosition);

	if ((ApproachDir.Magnitude) > 0.05) then
		ApproachDir = Vector3.new((ApproachDir.X), 0.0, (ApproachDir.Z));
	end

	if ((ApproachDir.Magnitude) <= 0.05) then
		ApproachDir = ((AttackerRoot.CFrame.LookVector).Unit);
	else
		ApproachDir = (ApproachDir.Unit);
	end

	local BehindOffsetDist: number = math.abs((CombatTable.VanishBehindDistance));
	local AmbushPosition: Vector3 = ((VictimPos + (ApproachDir * BehindOffsetDist)) + Vector3.new(0.0, (CombatTable.VanishHeightOffset), 0.0));
	local PlanarLookTarget: Vector3 = Vector3.new((VictimPos.X), (AmbushPosition.Y), (VictimPos.Z));
	local AmbushCFrame: CFrame = CFrame.lookAt(AmbushPosition, PlanarLookTarget);

	AttackerRoot.CFrame = AmbushCFrame;
	AttackerRoot.AssemblyLinearVelocity = Vector3.zero;
	VictimRoot.AssemblyLinearVelocity = Vector3.zero;

	---> Temporary Air-Stall Suspension on both Attacker and Target (`0.38s` weightless clash window)
	local StallDuration: number = (CombatTable.VanishAirStallDuration);
	local HoverForce: Vector3 = Vector3.new(95000, 95000, 95000);
	PhysicsImpulse.ApplyImpulse(AttackerRoot, Vector3.new(0.0, 1.5, 0.0), StallDuration, HoverForce);
	PhysicsImpulse.ApplyImpulse(VictimRoot, Vector3.new(0.0, 1.5, 0.0), StallDuration, HoverForce);

	RagdollHandler.SetRagdoll(TargetVictim, false);
	StunHandler.ApplyStun(TargetVictim, 0.72);
	TargetVictim:SetAttribute('LastCombatHitTime', os.clock());

	local IsAttackerRaging: boolean = StateHandler.GetBoolean(Attacker, 'IsRageActive');
	local BaseVanishDamage: number = (CombatTable.VanishDamage);
	local FinalVanishDamage: number = IsAttackerRaging and (BaseVanishDamage * (CombatTable.RageDamageMultiplier)) or BaseVanishDamage;

	VictimHumanoid:TakeDamage(FinalVanishDamage);
	StaminaHandler.AddRage(Attacker, (CombatTable.RageGainOnDealHit));

	local VanishAnimID: string = (AnimationRegistry.Fists[4]) or (AnimationRegistry.HeavyAttack);
	AnimationHandler.PlayAnimation(Attacker, VanishAnimID, (Enum.AnimationPriority.Action3), 1.35, 'Combo4');
	AnimationHandler.PlayProceduralPose(TargetVictim, 'HitFlinch', 1.1);

	local VanishHitstop: number = (CombatTable.HitstopVanishDuration);
	AnimationHandler.ApplyHitstop(Attacker, VanishHitstop);
	AnimationHandler.ApplyHitstop(TargetVictim, VanishHitstop);

	StateHandler.SetState(Attacker, 'Combo', 1);
	StateHandler.SetState(Attacker, 'IsAttacking', false);

	BroadcastVFX('VanishStrike', {
		Target         = TargetVictim,
		Attacker       = Attacker,
		OriginPosition = OriginPosition,
		Position       = (VictimRoot.Position),
		Damage         = FinalVanishDamage,
		IsHeavy        = true,
		HitstopTime    = VanishHitstop,
	});

	return true;
end

---> Checks whether <AttackerRoot> is positioned within <VictimRoot>'s frontal guard cone using planar dot-product math.
local function IsAttackWithinFrontalCone(AttackerRoot: BasePart, VictimRoot: BasePart): (boolean)
	local AttackerPos: Vector3 = (AttackerRoot.Position);
	local VictimPos: Vector3 = (VictimRoot.Position);
	local PlanarVector: Vector3 = Vector3.new(((AttackerPos.X) - (VictimPos.X)), 0.0, ((AttackerPos.Z) - (VictimPos.Z)));

	if ((PlanarVector.Magnitude) <= 0.05) then
		return true;
	end

	local DirectionToAttacker: Vector3 = (PlanarVector.Unit);
	local VictimForward: Vector3 = (VictimRoot.CFrame.LookVector);
	local PlanarForward: Vector3 = Vector3.new((VictimForward.X), 0.0, (VictimForward.Z));

	if ((PlanarForward.Magnitude) <= 0.05) then
		return true;
	end

	local AlignmentDot: number = DirectionToAttacker:Dot((PlanarForward.Unit));
	local IsFrontal: boolean = (AlignmentDot >= (CombatTable.FrontalBlockDotThreshold));

	return IsFrontal;
end

---> Processes an authoritative combat hit between <Attacker> and <Victim> using the unified <AttackStepDescriptor>.
local function ProcessEnvelopeHit(Attacker: Model, Victim: Model, AttackEnvelope: AttackStepDescriptor, IsHeavyHit: boolean?): (string)
	if not Attacker or not Victim or (Attacker == Victim) then
		return 'Ignored';
	end

	local AttackerHumanoid: Humanoid? = Attacker:FindFirstChildOfClass('Humanoid');
	local AttackerRoot: BasePart? = (Attacker:FindFirstChild('HumanoidRootPart') :: BasePart?);
	local VictimHumanoid: Humanoid? = Victim:FindFirstChildOfClass('Humanoid');
	local VictimRoot: BasePart? = (Victim:FindFirstChild('HumanoidRootPart') :: BasePart?);

	if not AttackerHumanoid or not AttackerRoot or not VictimHumanoid or not VictimRoot then
		return 'Ignored';
	end

	if ((AttackerHumanoid.Health) <= 0) or ((VictimHumanoid.Health) <= 0) then
		return 'Ignored';
	end

	Victim:SetAttribute('LastCombatHitTime', os.clock());
	Attacker:SetAttribute('LastCombatHitTime', os.clock());

	---> Step 1: Invulnerability Frames (Dash / Dodge)
	if StateHandler.GetBoolean(Victim, 'IsDodging') then
		BroadcastVFX('Dodged', {
			Target   = Victim,
			Attacker = Attacker,
		});

		return 'Dodged';
	end

	local IsFrontalGuard: boolean = IsAttackWithinFrontalCone(AttackerRoot, VictimRoot);
	local HeavyFlag: boolean = (IsHeavyHit == true) or (AttackEnvelope.GuardBreak);
	local AttackerWeapon: string = StateHandler.GetString(Attacker, 'EquippedWeapon', 'Fists');

	---> Step 2: Timed Frontal Parry Check
	if StateHandler.GetBoolean(Victim, 'IsParrying') and IsFrontalGuard then
		StateHandler.SetState(Victim, 'IsParrying', false);
		StunHandler.ApplyStun(Attacker, (CombatTable.ParryStunDuration));
		StaminaHandler.RestorePosture(Victim, (CombatTable.ParryPostureRestore));
		StaminaHandler.AddRage(Victim, (CombatTable.RageGainOnParry));

		AnimationHandler.PlayProceduralPose(Victim, 'Parry', 1.25);
		AnimationHandler.PlayProceduralPose(Attacker, 'HitFlinch', 0.9);
		AnimationHandler.ApplyHitstop(Attacker, (CombatTable.HitstopParryDuration));
		AnimationHandler.ApplyHitstop(Victim, (CombatTable.HitstopParryDuration));

		local RecoilDirection: Vector3 = (-((AttackerRoot.CFrame.LookVector).Unit));
		PhysicsImpulse.ApplyImpulse(AttackerRoot, (RecoilDirection * 24.0), 0.16);

		BroadcastVFX('Parry', {
			Target      = Attacker,
			Attacker    = Victim,
			Position    = (VictimRoot.Position),
			WeaponName  = AttackerWeapon,
			HitstopTime = (CombatTable.HitstopParryDuration),
		});

		return 'Parried';
	end

	local BaseDamage: number = (AttackEnvelope.Damage);
	local IsAttackerRaging: boolean = StateHandler.GetBoolean(Attacker, 'IsRageActive');
	local FinalDamage: number = IsAttackerRaging and (BaseDamage * (CombatTable.RageDamageMultiplier)) or BaseDamage;
	local StrikeDirection: Vector3 = ((AttackerRoot.CFrame.LookVector).Unit);

	---> Step 3: Frontal Block & Posture Stability Check
	if StateHandler.GetBoolean(Victim, 'IsBlocking') and IsFrontalGuard then
		local StaminaBlockCost: number = (FinalDamage * (CombatTable.BlockStaminaDrainPerDamage));
		local HasStaminaToBlock: boolean = StaminaHandler.Consume(Victim, StaminaBlockCost);
		local HasPostureStability: boolean = StaminaHandler.ConsumePosture(Victim, (AttackEnvelope.PostureDamage));

		if (AttackEnvelope.GuardBreak) or not HasStaminaToBlock or not HasPostureStability then
			StateHandler.SetState(Victim, 'IsBlocking', false);
			StateHandler.SetState(Victim, 'Posture', 0.0);

			StunHandler.ApplyStun(Victim, (CombatTable.GuardBreakStunDuration));
			AnimationHandler.PlayProceduralPose(Victim, 'HitFlinch', 0.85);

			local GuardBreakChipDamage: number = (FinalDamage * 0.5);
			VictimHumanoid:TakeDamage(GuardBreakChipDamage);

			StaminaHandler.AddRage(Attacker, (CombatTable.RageGainOnDealHit));
			AnimationHandler.ApplyHitstop(Attacker, (CombatTable.HitstopHeavyDuration));
			AnimationHandler.ApplyHitstop(Victim, (CombatTable.HitstopHeavyDuration));

			PhysicsImpulse.ApplyImpulse(VictimRoot, (StrikeDirection * 32.0), 0.2);

			BroadcastVFX('GuardBreak', {
				Target      = Victim,
				Attacker    = Attacker,
				Position    = (VictimRoot.Position),
				Damage      = GuardBreakChipDamage,
				WeaponName  = AttackerWeapon,
				HitstopTime = (CombatTable.HitstopHeavyDuration),
			});

			return 'GuardBroken';
		else
			local ChipDamage: number = (FinalDamage * (1.0 - (CombatTable.BlockDamageReduction)));
			VictimHumanoid:TakeDamage(ChipDamage);

			AnimationHandler.ApplyHitstop(Attacker, (CombatTable.HitstopLightDuration));
			AnimationHandler.ApplyHitstop(Victim, (CombatTable.HitstopLightDuration));

			PhysicsImpulse.ApplyImpulse(VictimRoot, (StrikeDirection * 12.0), 0.12);

			BroadcastVFX('Block', {
				Target      = Victim,
				Attacker    = Attacker,
				Position    = (VictimRoot.Position),
				Damage      = ChipDamage,
				PostureCost = (AttackEnvelope.PostureDamage),
				WeaponName  = AttackerWeapon,
				HitstopTime = (CombatTable.HitstopLightDuration),
			});

			return 'Blocked';
		end
	end

	---> Step 4: Unblocked Clean Hit (or Backstab Bypassing Block)
	if StateHandler.GetBoolean(Victim, 'IsBlocking') and not IsFrontalGuard then
		StateHandler.SetState(Victim, 'IsBlocking', false);
	end

	VictimHumanoid:TakeDamage(FinalDamage);
	StaminaHandler.AddRage(Attacker, (CombatTable.RageGainOnDealHit));
	StaminaHandler.AddRage(Victim, (CombatTable.RageGainOnTakeHit));

	local HitstopDuration: number = HeavyFlag and (CombatTable.HitstopHeavyDuration) or (CombatTable.HitstopLightDuration);
	AnimationHandler.ApplyHitstop(Attacker, HitstopDuration);
	AnimationHandler.ApplyHitstop(Victim, HitstopDuration);

	local IsFinisherOrLaunch: boolean = HeavyFlag or (AttackEnvelope.CausesRagdoll);
	local OpenedVanish: boolean = false;

	if IsFinisherOrLaunch then
		local FinisherHorizontal: number = math.clamp((AttackEnvelope.KnockbackSpeed), (CombatTable.FinisherMinHorizontalSpeed), (CombatTable.FinisherMaxHorizontalSpeed));
		local FinisherVertical: number = (CombatTable.FinisherVerticalLaunchSpeed);
		local LaunchVelocity: Vector3 = ((StrikeDirection * FinisherHorizontal) + Vector3.new(0.0, FinisherVertical, 0.0));

		RagdollHandler.LaunchCharacter(Victim, StrikeDirection, FinisherHorizontal, FinisherVertical, (CombatTable.FinisherLaunchStateDuration));
		RagdollHandler.SetRagdoll(Victim, true, 1.45, LaunchVelocity);

		if ((VictimHumanoid.Health) > 0) then
			OpenVanishWindow(Attacker, Victim);
			OpenedVanish = true;
		end
	else
		local KnockbackVector: Vector3 = (StrikeDirection * (AttackEnvelope.KnockbackSpeed));
		StunHandler.ApplyStun(Victim, (AttackEnvelope.StunDuration));
		AnimationHandler.PlayProceduralPose(Victim, 'HitFlinch', 1.15);
		PhysicsImpulse.ApplyImpulse(VictimRoot, KnockbackVector, 0.16);
	end

	SoundHandler.PlayImpact(Victim, 'Hit', AttackerWeapon, HeavyFlag);

	BroadcastVFX('Hit', {
		Target      = Victim,
		Attacker    = Attacker,
		Position    = (VictimRoot.Position),
		Direction   = StrikeDirection,
		Damage      = FinalDamage,
		IsHeavy     = HeavyFlag,
		IsCrit      = (not IsFrontalGuard),
		WeaponName  = AttackerWeapon,
		StatusText  = OpenedVanish and 'VanishReady' or nil,
		HitstopTime = HitstopDuration,
	});

	return 'Hit';
end



local HitService: HitServiceModule = {
	ProcessEnvelopeHit       = ProcessEnvelopeHit,
	TryExecuteVanishFollowUp = TryExecuteVanishFollowUp,
};



return HitService;
