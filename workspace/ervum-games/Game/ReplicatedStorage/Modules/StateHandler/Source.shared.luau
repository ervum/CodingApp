--!strict

local ReplicatedStorage: ReplicatedStorage = game:GetService('ReplicatedStorage');
local ModulesFolder: Instance = ReplicatedStorage:WaitForChild('Modules');

local CombatTypes = require(ModulesFolder:WaitForChild('CombatTypes') :: ModuleScript);
local CombatTable = require(ModulesFolder:WaitForChild('CombatTable') :: ModuleScript);



export type StateValue = CombatTypes.StateValue;

export type StateHandlerModule = {
	InitEntity:    ((Instance) -> ()),
	SetState:      ((Instance, string, StateValue) -> ()),
	GetState:      ((Instance, string) -> (StateValue?)),
	GetBoolean:    ((Instance, string) -> (boolean)),
	GetNumber:     ((Instance, string, number?) -> (number)),
	GetString:     ((Instance, string, string?) -> (string)),
	CanAct:        ((Instance) -> (boolean)),
	CanMoveFreely: ((Instance) -> (boolean)),
};



local DefaultStates: { [string?]: StateValue } = {
	IsAttacking          = false,
	IsBlocking           = false,
	IsParrying           = false,
	IsStunned            = false,
	IsRagdolled          = false,
	IsDodging            = false,
	IsClimbing           = false,
	IsWallRunning        = false,
	IsGliding            = false,
	IsRageActive         = false,
	CanVanishFollowUp    = false,
	Combo                = 1,
	Stamina              = (CombatTable.MaxStamina),
	MaxStamina           = (CombatTable.MaxStamina),
	Posture              = (CombatTable.MaxPosture),
	MaxPosture           = (CombatTable.MaxPosture),
	Rage                 = 0.0,
	MaxRage              = (CombatTable.MaxRage),
	LastParryAttemptTime = 0.0,
	LastStaminaUseTime   = 0.0,
	LastPostureHitTime   = 0.0,
	EquippedWeapon       = 'Fists',
};



---> Initializes all combat, posture, rage, and traversal Attributes on an <Entity>.
local function InitEntity(Entity: Instance): ()
	if not Entity then return end

	for StateKey: string?, DefaultVal: StateValue in DefaultStates do
		if StateKey and (Entity:GetAttribute(StateKey) == nil) then
			Entity:SetAttribute(StateKey, DefaultVal);
		end
	end

	return;
end

---> Updates a replicated state Attribute on an <Entity>.
local function SetState(Entity: Instance, StateName: string, Value: StateValue): ()
	if not Entity then return end

	Entity:SetAttribute(StateName, Value);

	return;
end

---> Reads a raw typed state Attribute from an <Entity>.
local function GetState(Entity: Instance, StateName: string): (StateValue?)
	if not Entity then return nil end

	local RawAttr: StateValue? = (Entity:GetAttribute(StateName) :: StateValue?);

	return RawAttr;
end

---> Reads a boolean state Attribute from an <Entity>, defaulting to false.
local function GetBoolean(Entity: Instance, StateName: string): (boolean)
	if not Entity then return false end

	local RawAttr: StateValue? = (Entity:GetAttribute(StateName) :: StateValue?);
	local IsTrue: boolean = (RawAttr == true);

	return IsTrue;
end

---> Reads a numeric state Attribute from an <Entity> with a fallback default.
local function GetNumber(Entity: Instance, StateName: string, DefaultFallback: number?): (number)
	local Fallback: number = DefaultFallback or 0.0;

	if not Entity then return Fallback end

	local RawAttr: StateValue? = (Entity:GetAttribute(StateName) :: StateValue?);

	if (type(RawAttr) == 'number') then
		return RawAttr;
	end

	return Fallback;
end

---> Reads a string state Attribute from an <Entity> with a fallback default.
local function GetString(Entity: Instance, StateName: string, DefaultFallback: string?): (string)
	local Fallback: string = DefaultFallback or '';

	if not Entity then return Fallback end

	local RawAttr: StateValue? = (Entity:GetAttribute(StateName) :: StateValue?);

	if (type(RawAttr) == 'string') then
		return RawAttr;
	end

	return Fallback;
end

---> Checks whether an <Entity> is free to initiate a new combat action.
local function CanAct(Entity: Instance): (boolean)
	if not Entity then return false end

	if GetBoolean(Entity, 'IsStunned') then return false end
	if GetBoolean(Entity, 'IsRagdolled') then return false end
	if GetBoolean(Entity, 'IsAttacking') then return false end
	if GetBoolean(Entity, 'IsBlocking') then return false end
	if GetBoolean(Entity, 'IsDodging') then return false end
	if GetBoolean(Entity, 'IsClimbing') then return false end
	if GetBoolean(Entity, 'IsWallRunning') then return false end
	if GetBoolean(Entity, 'IsGliding') then return false end

	return true;
end

---> Checks whether an <Entity> can initiate movement abilities like Dash or Traversal.
local function CanMoveFreely(Entity: Instance): (boolean)
	if not Entity then return false end

	if GetBoolean(Entity, 'IsStunned') then return false end
	if GetBoolean(Entity, 'IsRagdolled') then return false end
	if GetBoolean(Entity, 'IsAttacking') then return false end

	return true;
end



local StateHandler: StateHandlerModule = {
	InitEntity    = InitEntity,
	SetState      = SetState,
	GetState      = GetState,
	GetBoolean    = GetBoolean,
	GetNumber     = GetNumber,
	GetString     = GetString,
	CanAct        = CanAct,
	CanMoveFreely = CanMoveFreely,
};



return StateHandler;
