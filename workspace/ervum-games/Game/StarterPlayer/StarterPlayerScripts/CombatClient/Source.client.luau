--!strict

local Players: Players = game:GetService('Players');
local ReplicatedStorage: ReplicatedStorage = game:GetService('ReplicatedStorage');
local UIS: UserInputService = game:GetService('UserInputService');
local WS: Workspace = game:GetService('Workspace');

local ModulesFolder: Instance = ReplicatedStorage:WaitForChild('Modules');
local RemoteFolder: Instance = ReplicatedStorage:WaitForChild('RemoteEvents');

local AnimationHandler = require(ModulesFolder:WaitForChild('AnimationHandler') :: ModuleScript);
local CameraFeelController = require(ModulesFolder:WaitForChild('CameraFeelController') :: ModuleScript);
local CombatTable = require(ModulesFolder:WaitForChild('CombatTable') :: ModuleScript);
local CombatTypes = require(ModulesFolder:WaitForChild('CombatTypes') :: ModuleScript);
local DamageIndicator = require(ModulesFolder:WaitForChild('DamageIndicator') :: ModuleScript);
local MovementVFX = require(ModulesFolder:WaitForChild('MovementVFX') :: ModuleScript);
local SoundHandler = require(ModulesFolder:WaitForChild('SoundHandler') :: ModuleScript);
local StateHandler = require(ModulesFolder:WaitForChild('StateHandler') :: ModuleScript);
local WeaponConfig = require(ModulesFolder:WaitForChild('WeaponConfig') :: ModuleScript);

local CombatActionRemote: RemoteEvent = (RemoteFolder:WaitForChild('CombatAction') :: RemoteEvent);
local VFXReplicationRemote: RemoteEvent = (RemoteFolder:WaitForChild('VFXReplication') :: RemoteEvent);



type CombatActionPayload = CombatTypes.CombatActionPayload;
type VFXPayload = CombatTypes.VFXPayload;

type BufferedCommand = {
	ActionName: string,
	Payload:    CombatActionPayload?,
	Timestamp:  number,
};



local LocalPlayer: Player = Players.LocalPlayer;
local IsHoldingM1: boolean = false;
local QueuedBufferCommand: BufferedCommand? = nil;
local LastLocalSwingClock: number = 0.0;
local LastLocalHitClock: number = 0.0;

local function FindNearbyEnemyModel(OriginCharacter: Model, MaxRange: number): (Model?)
	local OriginRoot: BasePart? = (OriginCharacter:FindFirstChild('HumanoidRootPart') :: BasePart?);

	if not OriginRoot then return nil end

	local LiveFolder: Instance? = WS:FindFirstChild('Live');
	local SearchRoots: { [number]: Instance } = LiveFolder and { LiveFolder, WS } or { WS };
	local BestEnemy: Model? = nil;
	local BestDist: number = MaxRange;

	for _: number, Container: Instance in SearchRoots do
		for _: number, ChildObj: Instance in Container:GetChildren() do
			if ChildObj:IsA('Model') and (ChildObj ~= OriginCharacter) then
				local EnemyHum: Humanoid? = ChildObj:FindFirstChildOfClass('Humanoid');
				local EnemyRoot: BasePart? = (ChildObj:FindFirstChild('HumanoidRootPart') :: BasePart?) or (ChildObj.PrimaryPart);

				if EnemyHum and EnemyRoot and ((EnemyHum.Health) > 0) then
					local Dist: number = (((EnemyRoot.Position) - (OriginRoot.Position)).Magnitude);

					if (Dist <= BestDist) then
						BestDist = Dist;
						BestEnemy = ChildObj;
					end
				end
			end
		end
	end

	return BestEnemy;
end

local HotkeyToWeaponMap: { [Enum.KeyCode?]: string } = {
	[(Enum.KeyCode.One)]   = 'Fists',
	[(Enum.KeyCode.Two)]   = 'Sword',
	[(Enum.KeyCode.Three)] = 'Katana',
	[(Enum.KeyCode.Four)]  = 'Spear',
	[(Enum.KeyCode.Five)]  = 'Bow',
};



local function ComputeDashDirectionAndKey(): (Vector3, string)
	local ActiveCamera: Camera? = (WS.CurrentCamera);
	local Character: Model? = (LocalPlayer.Character);

	if not ActiveCamera or not Character then
		return Vector3.new(0, 0, -1), 'Forward';
	end

	local SafeCamera: Camera = (ActiveCamera :: Camera);
	local CamLook: Vector3 = Vector3.new((SafeCamera.CFrame.LookVector.X), 0.0, (SafeCamera.CFrame.LookVector.Z));
	local CamRight: Vector3 = Vector3.new((SafeCamera.CFrame.RightVector.X), 0.0, (SafeCamera.CFrame.RightVector.Z));

	if ((CamLook.Magnitude) > 0.01) then
		CamLook = (CamLook.Unit);
	end

	if ((CamRight.Magnitude) > 0.01) then
		CamRight = (CamRight.Unit);
	end

	local MoveVector: Vector3 = Vector3.zero;
	local DashKeyName: string = 'Forward';

	if UIS:IsKeyDown(Enum.KeyCode.W) then
		MoveVector = (MoveVector + CamLook);
		DashKeyName = 'Forward';
	end

	if UIS:IsKeyDown(Enum.KeyCode.S) then
		MoveVector = (MoveVector - CamLook);
		DashKeyName = 'Backward';
	end

	if UIS:IsKeyDown(Enum.KeyCode.A) then
		MoveVector = (MoveVector - CamRight);
		DashKeyName = 'Left';
	end

	if UIS:IsKeyDown(Enum.KeyCode.D) then
		MoveVector = (MoveVector + CamRight);
		DashKeyName = 'Right';
	end

	if ((MoveVector.Magnitude) <= 0.05) then
		local RootPart: BasePart? = (Character:FindFirstChild('HumanoidRootPart') :: BasePart?);

		if RootPart then
			return ((RootPart.CFrame.LookVector).Unit), 'Forward';
		end

		return CamLook, 'Forward';
	end

	return (MoveVector.Unit), DashKeyName;
end

---> Dispatches a combat action immediately if the character can act (or has a Vanish Follow-Up window), or buffers it within `160ms`.
local function DispatchOrBufferAction(ActionName: string, Payload: CombatActionPayload?): ()
	local Character: Model? = (LocalPlayer.Character);

	if not Character then return end

	local HasVanishWindow: boolean = StateHandler.GetBoolean(Character, 'CanVanishFollowUp') and ((ActionName == 'LightAttack') or (ActionName == 'Dash'));

	if StateHandler.CanAct(Character) or HasVanishWindow or (ActionName == 'Dash') or (ActionName == 'ActivateRage') then
		CombatActionRemote:FireServer(ActionName, Payload);

		if (ActionName == 'LightAttack') then
			local StyleName: string = StateHandler.GetString(Character, 'EquippedWeapon', 'Fists');
			local StepNumber: number = math.clamp(StateHandler.GetNumber(Character, 'Combo', 1), 1, 4);
			local IsFinisher: boolean = (StepNumber == 4);
			local PoseKey: string = (StyleName == 'Fists') and ('FistCombo' .. tostring(StepNumber)) or ('Combo' .. tostring(StepNumber));

			LastLocalSwingClock = os.clock();
			AnimationHandler.PlayProceduralPose(Character, PoseKey, IsFinisher and 1.15 or 1.38);
			SoundHandler.PlaySwing(Character, StyleName, IsFinisher);

			local NearbyEnemy: Model? = FindNearbyEnemyModel(Character, 9.5);

			if NearbyEnemy then
				LastLocalHitClock = os.clock();
				SoundHandler.PlayImpact(NearbyEnemy, 'Hit', StyleName, IsFinisher);
			end
		elseif (ActionName == 'Dash') then
			CameraFeelController.PunchFOV((CombatTable.DashFOVPunch), 0.25);
			CameraFeelController.PulseBlur((CombatTable.DashBlurSize), 0.24);
		elseif (ActionName == 'HeavyAttack') or (ActionName == 'AirSlam') then
			CameraFeelController.SetFOVState('Charge');

			task.delay(0.16, function(): ()
				CameraFeelController.SetFOVState('Default');
				CameraFeelController.PunchFOV((CombatTable.HeavyFOVPunch), 0.32);

				return;
			end);
		elseif (ActionName == 'ActivateRage') then
			CameraFeelController.PunchFOV((CombatTable.RageFOVPunch), 0.45);
		end

		return;
	end

	QueuedBufferCommand = {
		ActionName = ActionName,
		Payload    = Payload,
		Timestamp  = os.clock(),
	};

	return;
end

local function TriggerLightOrAirAttack(): ()
	local Character: Model? = (LocalPlayer.Character);

	if not Character then return end

	local Humanoid: Humanoid? = Character:FindFirstChildOfClass('Humanoid');
	local IsAirborne: boolean = (Humanoid ~= nil) and ((Humanoid.FloorMaterial) == (Enum.Material.Air));

	if IsAirborne and UIS:IsKeyDown(Enum.KeyCode.Space) then
		DispatchOrBufferAction('AirSlam', nil);
	else
		DispatchOrBufferAction('LightAttack', nil);
	end

	return;
end

local function BindCharacterStateListeners(Character: Model): ()
	Character:GetAttributeChangedSignal('IsAttacking'):Connect(function(): ()
		local IsNowAttacking: boolean = StateHandler.GetBoolean(Character, 'IsAttacking');

		if not IsNowAttacking and QueuedBufferCommand then
			local Buffered: BufferedCommand = (QueuedBufferCommand :: BufferedCommand);
			QueuedBufferCommand = nil;

			if ((os.clock() - (Buffered.Timestamp)) <= (CombatTable.InputBufferWindow)) then
				DispatchOrBufferAction((Buffered.ActionName), (Buffered.Payload));
			end
		end

		return;
	end);

	Character:GetAttributeChangedSignal('IsRageActive'):Connect(function(): ()
		local RageState: boolean = StateHandler.GetBoolean(Character, 'IsRageActive');

		if not RageState then
			MovementVFX.SetRageAuraActive(Character, false);
		end

		return;
	end);

	return;
end



if (LocalPlayer.Character) then
	BindCharacterStateListeners(LocalPlayer.Character :: Model);
end

LocalPlayer.CharacterAdded:Connect(function(NewCharacter: Model): ()
	CameraFeelController.ClearLockOn();
	BindCharacterStateListeners(NewCharacter);

	return;
end);

---> Hold-to-Combo M1 polling loop so holding MouseButton1 smoothly chains 4-hit combos.
task.spawn(function(): ()
	while true do
		if IsHoldingM1 then
			local Character: Model? = (LocalPlayer.Character);

			if Character and (StateHandler.CanAct(Character) or StateHandler.GetBoolean(Character, 'CanVanishFollowUp')) then
				TriggerLightOrAirAttack();
			end
		end

		task.wait((CombatTable.HoldComboPollInterval));
	end
end);

UIS.InputBegan:Connect(function(InputObject: InputObject, GameProcessed: boolean): ()
	if GameProcessed then return end

	local InputType: Enum.UserInputType = (InputObject.UserInputType);
	local KeyCode: Enum.KeyCode = (InputObject.KeyCode);

	if (InputType == (Enum.UserInputType.MouseButton1)) then
		IsHoldingM1 = true;
		TriggerLightOrAirAttack();
	elseif (InputType == (Enum.UserInputType.MouseButton3)) or (KeyCode == (Enum.KeyCode.LeftAlt)) then
		CameraFeelController.ToggleLockOn();
	elseif (KeyCode == (Enum.KeyCode.R)) then
		DispatchOrBufferAction('HeavyAttack', nil);
	elseif (KeyCode == (Enum.KeyCode.F)) then
		CombatActionRemote:FireServer('Block', { State = true });

		local Character: Model? = (LocalPlayer.Character);

		if Character and StateHandler.CanAct(Character) then
			AnimationHandler.PlayProceduralPose(Character, 'Block', 1.0);
		end
	elseif (KeyCode == (Enum.KeyCode.Q)) then
		local DashDir: Vector3, DashKey: string = ComputeDashDirectionAndKey();
		DispatchOrBufferAction('Dash', {
			Direction = DashDir,
			DashKey   = DashKey,
		});
	elseif (KeyCode == (Enum.KeyCode.G)) then
		DispatchOrBufferAction('ActivateRage', nil);
	elseif HotkeyToWeaponMap[KeyCode] then
		local SelectedStyle: string = (HotkeyToWeaponMap[KeyCode] :: string);

		if (WeaponConfig.Weapons[SelectedStyle] ~= nil) then
			CombatActionRemote:FireServer('SwitchWeapon', { WeaponName = SelectedStyle });
		end
	end

	return;
end);

UIS.InputEnded:Connect(function(InputObject: InputObject, _: boolean): ()
	local InputType: Enum.UserInputType = (InputObject.UserInputType);
	local KeyCode: Enum.KeyCode = (InputObject.KeyCode);

	if (InputType == (Enum.UserInputType.MouseButton1)) then
		IsHoldingM1 = false;
	elseif (KeyCode == (Enum.KeyCode.F)) then
		CombatActionRemote:FireServer('Block', { State = false });

		local Character: Model? = (LocalPlayer.Character);

		if Character then
			AnimationHandler.StopProceduralPose(Character);
		end
	end

	return;
end);

VFXReplicationRemote.OnClientEvent:Connect(function(EffectName: string, PayloadData: VFXPayload?): ()
	local SafePayload: VFXPayload = PayloadData or { };
	local TargetEntity: Instance? = (SafePayload.Target);
	local AttackerEntity: Instance? = (SafePayload.Attacker);
	local MyCharacter: Model? = (LocalPlayer.Character);
	local InvolvesLocalPlayer: boolean = ((TargetEntity == MyCharacter) or (AttackerEntity == MyCharacter));

	if (EffectName == 'Slash') and AttackerEntity and AttackerEntity:IsA('Model') then
		local StyleName: string = (SafePayload.WeaponName) or 'Fists';
		local HeavyAttackFlag: boolean = (SafePayload.IsHeavy == true);
		local StepNumber: number = math.clamp((SafePayload.ComboStep or 1), 1, 4);
		local PoseKey: string = `Combo{StepNumber}`;

		if (StyleName == 'Fists') then
			PoseKey = HeavyAttackFlag and 'FistHeavy' or `FistCombo{StepNumber}`;
		elseif HeavyAttackFlag then
			PoseKey = 'Heavy';
		end

		if (AttackerEntity ~= MyCharacter) or ((os.clock() - LastLocalSwingClock) > 0.28) then
			AnimationHandler.PlayProceduralPose(AttackerEntity, PoseKey, HeavyAttackFlag and 1.15 or 1.38);
			SoundHandler.PlaySwing(AttackerEntity, StyleName, HeavyAttackFlag);
		end

		MovementVFX.PlaySlashVFX(AttackerEntity, StyleName, HeavyAttackFlag, StepNumber);
	elseif (EffectName == 'Hit') and TargetEntity then
		if (AttackerEntity ~= MyCharacter) or ((os.clock() - LastLocalHitClock) > 0.28) then
			SoundHandler.PlayImpact(TargetEntity, 'Hit', (SafePayload.WeaponName), (SafePayload.IsHeavy));
		end
		MovementVFX.PlayHitVFX(TargetEntity, (SafePayload.IsHeavy), 'Hit');
		DamageIndicator.Spawn(TargetEntity, (SafePayload.Damage or 10.0), ((SafePayload.IsHeavy == true) or (SafePayload.IsCrit == true)));

		if TargetEntity:IsA('Model') and not (SafePayload.IsHeavy == true) and ((SafePayload.StatusText) ~= 'VanishReady') then
			AnimationHandler.PlayProceduralPose(TargetEntity, 'HitFlinch', 1.5);
		end

		if ((SafePayload.StatusText) == 'VanishReady') and (AttackerEntity == MyCharacter) then
			DamageIndicator.ShowVanishPrompt(TargetEntity, (CombatTable.VanishWindowDuration));
		end

		if InvolvesLocalPlayer then
			local IsHeavyHit: boolean = (SafePayload.IsHeavy == true);
			local TraumaForce: number = IsHeavyHit and 0.62 or 0.32;
			CameraFeelController.AddTrauma(TraumaForce);

			if IsHeavyHit then
				CameraFeelController.PlayBezierSpline('HeavyFinish');
				CameraFeelController.PunchFOV((CombatTable.HeavyFOVPunch), 0.28);
				CameraFeelController.PulseBlur((CombatTable.HeavyBlurSize), 0.22);
			end
		end

		if (SafePayload.HitstopTime) and MyCharacter and InvolvesLocalPlayer then
			AnimationHandler.ApplyHitstop(MyCharacter, (SafePayload.HitstopTime :: number));
		end
	elseif (EffectName == 'VanishStrike') and AttackerEntity and AttackerEntity:IsA('Model') and TargetEntity then
		local OriginPos: Vector3 = (SafePayload.OriginPosition) or Vector3.zero;
		local DestPos: Vector3 = (SafePayload.Position) or Vector3.zero;
		local VanishStyle: string = (SafePayload.WeaponName) or 'Fists';

		AnimationHandler.PlayProceduralPose(AttackerEntity, (VanishStyle == 'Fists') and 'FistHeavy' or 'Heavy', 1.35);
		DamageIndicator.HideVanishPrompt(TargetEntity);
		SoundHandler.PlayImpact(TargetEntity, 'Vanish', VanishStyle, true);
		MovementVFX.PlayVanishVFX(AttackerEntity, OriginPos, DestPos);
		MovementVFX.PlayHitVFX(TargetEntity, true, 'Vanish');
		DamageIndicator.SpawnCallout(AttackerEntity, 'VANISH STRIKE!', Color3.fromRGB(205, 115, 255), 34.0);
		DamageIndicator.Spawn(TargetEntity, (SafePayload.Damage or (CombatTable.VanishDamage)), true);

		if InvolvesLocalPlayer then
			CameraFeelController.PlayBezierSpline('VanishChase');
			CameraFeelController.PunchFOV((CombatTable.VanishFOVPunch), 0.32);
			CameraFeelController.TriggerImpactFrames('Vanish');
			CameraFeelController.AddTrauma(0.72);

			if MyCharacter then
				AnimationHandler.ApplyHitstop(MyCharacter, (SafePayload.HitstopTime or (CombatTable.HitstopVanishDuration)));
			end
		end
	elseif (EffectName == 'Block') and TargetEntity then
		SoundHandler.PlayImpact(TargetEntity, 'Block', (SafePayload.WeaponName), false);
		MovementVFX.PlayHitVFX(TargetEntity, false, 'Block');
		DamageIndicator.SpawnCallout(TargetEntity, 'BLOCKED', Color3.fromRGB(115, 185, 255), 22.0);

		if InvolvesLocalPlayer then
			CameraFeelController.AddTrauma(0.22);
			CameraFeelController.PulseBlur(4.5, 0.14);
		end
	elseif (EffectName == 'Parry') and TargetEntity then
		if TargetEntity:IsA('Model') then
			AnimationHandler.PlayProceduralPose(TargetEntity, 'Parry', 1.4);
		end

		SoundHandler.PlayImpact(TargetEntity, 'Parry', (SafePayload.WeaponName), true);
		MovementVFX.PlayHitVFX(TargetEntity, true, 'Parry');
		DamageIndicator.SpawnCallout(TargetEntity, 'PARRIED!', Color3.fromRGB(75, 240, 255), 34.0);

		if InvolvesLocalPlayer then
			CameraFeelController.TriggerImpactFrames('Parry');
			CameraFeelController.PlayBezierSpline('GuardBreak');
			CameraFeelController.AddTrauma(0.68);
			CameraFeelController.PunchFOV(62.0, 0.28);

			if MyCharacter then
				AnimationHandler.ApplyHitstop(MyCharacter, (SafePayload.HitstopTime or (CombatTable.HitstopParryDuration)));
			end
		end
	elseif (EffectName == 'GuardBreak') and TargetEntity then
		SoundHandler.PlayImpact(TargetEntity, 'GuardBreak', (SafePayload.WeaponName), true);
		MovementVFX.PlayHitVFX(TargetEntity, true, 'GuardBreak');
		DamageIndicator.SpawnCallout(TargetEntity, 'GUARD BROKEN!', Color3.fromRGB(255, 55, 75), 36.0);

		if InvolvesLocalPlayer then
			CameraFeelController.TriggerImpactFrames('GuardBreak');
			CameraFeelController.PlayBezierSpline('GuardBreak');
			CameraFeelController.AddTrauma(0.78);

			if MyCharacter then
				AnimationHandler.ApplyHitstop(MyCharacter, (SafePayload.HitstopTime or (CombatTable.HitstopHeavyDuration)));
			end
		end
	elseif (EffectName == 'Dodged') and TargetEntity then
		DamageIndicator.SpawnCallout(TargetEntity, 'EVADED', Color3.fromRGB(165, 235, 255), 22.0);
	elseif (EffectName == 'Dash') and AttackerEntity and AttackerEntity:IsA('Model') then
		AnimationHandler.PlayProceduralPose(AttackerEntity, 'DashForward', 1.5);
		SoundHandler.PlaySound(AttackerEntity, 'Dash');
		MovementVFX.SpawnDashAfterimage(AttackerEntity, (SafePayload.Direction));
	elseif (EffectName == 'AirSlamImpact') and (SafePayload.Position) then
		SoundHandler.PlaySound((SafePayload.Position), 'AirSlam');
		MovementVFX.PlayExplosionShockwave((SafePayload.Position :: Vector3), (CombatTable.AirSlamRadius), Color3.fromRGB(255, 155, 45));

		if InvolvesLocalPlayer then
			CameraFeelController.TriggerImpactFrames('AirSlam');
			CameraFeelController.PlayBezierSpline('HeavyFinish');
			CameraFeelController.AddTrauma(0.85);
		end
	elseif (EffectName == 'RageAwaken') and AttackerEntity and AttackerEntity:IsA('Model') then
		AnimationHandler.PlayProceduralPose(AttackerEntity, 'RageAwaken', 1.0);
		SoundHandler.PlaySound(AttackerEntity, 'RageAwaken');
		MovementVFX.SetRageAuraActive(AttackerEntity, true);
		DamageIndicator.SpawnCallout(AttackerEntity, 'RAGE AWAKENED!', Color3.fromRGB(255, 205, 55), 36.0);

		if InvolvesLocalPlayer then
			CameraFeelController.PlayBezierSpline('RageAwakening');
			CameraFeelController.TriggerImpactFrames('Rage');
			CameraFeelController.AddTrauma(0.72);
			CameraFeelController.PunchFOV((CombatTable.RageFOVPunch), 0.52);
		end
	end

	return;
end);
