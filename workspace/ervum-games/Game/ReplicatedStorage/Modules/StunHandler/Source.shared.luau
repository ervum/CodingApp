--!strict

local ReplicatedStorage: ReplicatedStorage = game:GetService('ReplicatedStorage');
local ModulesFolder: Instance = ReplicatedStorage:WaitForChild('Modules');

local CombatTable = require(ModulesFolder:WaitForChild('CombatTable') :: ModuleScript);
local StateHandler = require(ModulesFolder:WaitForChild('StateHandler') :: ModuleScript);



export type StunHandlerModule = {
	ApplyStun: ((Model, number) -> ()),
	ClearStun: ((Model) -> ()),
};



local ActiveStunTokens: { [Model?]: number } = { };



---> Applies a token-guarded stun to <Character>, interrupting active states and locking movement for <Duration> seconds.
local function ApplyStun(Character: Model, Duration: number): ()
	if not Character then return end

	local Humanoid: Humanoid? = Character:FindFirstChildOfClass('Humanoid');

	if not Humanoid or ((Humanoid.Health) <= 0) then return end

	local NextToken: number = ((ActiveStunTokens[Character] or 0) + 1);
	ActiveStunTokens[Character] = NextToken;

	StateHandler.SetState(Character, 'IsStunned', true);
	StateHandler.SetState(Character, 'IsAttacking', false);
	StateHandler.SetState(Character, 'IsBlocking', false);
	StateHandler.SetState(Character, 'IsParrying', false);
	StateHandler.SetState(Character, 'IsClimbing', false);
	StateHandler.SetState(Character, 'IsWallRunning', false);
	StateHandler.SetState(Character, 'IsGliding', false);

	Humanoid.WalkSpeed = 0.0;
	Humanoid.JumpPower = 0.0;

	task.delay(Duration, function(): ()
		if (ActiveStunTokens[Character] ~= NextToken) then return end

		StateHandler.SetState(Character, 'IsStunned', false);

		if not StateHandler.GetBoolean(Character, 'IsRagdolled') and ((Humanoid.Health) > 0) then
			local IsRageActive: boolean = StateHandler.GetBoolean(Character, 'IsRageActive');
			local RestoredSpeed: number = IsRageActive and (CombatTable.RageWalkSpeed) or (CombatTable.DefaultWalkSpeed);
			local IsPassiveDummy: boolean = (Character:GetAttribute('IsPassiveDummy') == true);

			Humanoid.WalkSpeed = IsPassiveDummy and 0.0 or RestoredSpeed;
			Humanoid.JumpPower = (CombatTable.DefaultJumpPower);
		end

		return;
	end);

	return;
end

---> Immediately clears any active stun on <Character> and restores locomotion speed.
local function ClearStun(Character: Model): ()
	if not Character then return end

	local NextToken: number = ((ActiveStunTokens[Character] or 0) + 1);
	ActiveStunTokens[Character] = NextToken;

	StateHandler.SetState(Character, 'IsStunned', false);

	local Humanoid: Humanoid? = Character:FindFirstChildOfClass('Humanoid');

	if Humanoid and ((Humanoid.Health) > 0) and not StateHandler.GetBoolean(Character, 'IsRagdolled') then
		local IsRageActive: boolean = StateHandler.GetBoolean(Character, 'IsRageActive');
		local RestoredSpeed: number = IsRageActive and (CombatTable.RageWalkSpeed) or (CombatTable.DefaultWalkSpeed);
		local IsPassiveDummy: boolean = (Character:GetAttribute('IsPassiveDummy') == true);

		Humanoid.WalkSpeed = IsPassiveDummy and 0.0 or RestoredSpeed;
		Humanoid.JumpPower = (CombatTable.DefaultJumpPower);
	end

	return;
end



local StunHandler: StunHandlerModule = {
	ApplyStun = ApplyStun,
	ClearStun = ClearStun,
};



return StunHandler;
