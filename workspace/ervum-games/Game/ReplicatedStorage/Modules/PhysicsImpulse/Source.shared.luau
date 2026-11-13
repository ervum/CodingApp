--!strict

local D: Debris = game:GetService('Debris');



export type ActiveMoverHandle = {
	AttachmentObject: Attachment,
	VelocityMover:    LinearVelocity,
	Destroy:          (() -> ()),
};

export type PhysicsImpulseModule = {
	ApplyImpulse:          ((BasePart, Vector3, number, Vector3?) -> ()),
	CreatePersistentMover: ((BasePart, string, Vector3, Vector3?) -> (ActiveMoverHandle)),
	ClearMoverByName:      ((BasePart, string) -> ()),
};



---> Applies a temporary <LinearVelocity> impulse to <TargetPart> and cleans up via <Debris>.
local function ApplyImpulse(TargetPart: BasePart, VelocityVector: Vector3, Duration: number, MaxAxesForce: Vector3?): ()
	if not TargetPart or not (TargetPart.Parent) then return end

	local ImpulseAttachment: Attachment = Instance.new('Attachment');
	ImpulseAttachment.Name = 'CombatImpulseAttachment';
	ImpulseAttachment.Parent = TargetPart;

	local VelocityConstraint: LinearVelocity = Instance.new('LinearVelocity');
	VelocityConstraint.Name = 'CombatLinearImpulse';
	VelocityConstraint.Attachment0 = ImpulseAttachment;
	VelocityConstraint.RelativeTo = (Enum.ActuatorRelativeTo.World);
	VelocityConstraint.VelocityConstraintMode = (Enum.VelocityConstraintMode.Vector);
	VelocityConstraint.ForceLimitMode = (Enum.ForceLimitMode.PerAxis);
	VelocityConstraint.MaxAxesForce = MaxAxesForce or Vector3.new(85000, 85000, 85000);
	VelocityConstraint.VectorVelocity = VelocityVector;
	VelocityConstraint.Parent = TargetPart;

	local SafeDuration: number = math.max(0.03, Duration);

	D:AddItem(VelocityConstraint, SafeDuration);
	D:AddItem(ImpulseAttachment, SafeDuration);

	return;
end

---> Removes any existing <LinearVelocity> and <Attachment> matching <MoverName> on <TargetPart>.
local function ClearMoverByName(TargetPart: BasePart, MoverName: string): ()
	if not TargetPart then return end

	local AttachmentName: string = `{MoverName}Attachment`;

	for _: number, ChildObject: Instance in TargetPart:GetChildren() do
		if (ChildObject.Name == MoverName) or (ChildObject.Name == AttachmentName) then
			ChildObject:Destroy();
		end
	end

	return;
end

---> Creates a continuous <LinearVelocity> mover for traversal states (WallClimb, WallRun, Glider).
local function CreatePersistentMover(TargetPart: BasePart, MoverName: string, InitialVelocity: Vector3, MaxAxesForce: Vector3?): (ActiveMoverHandle)
	ClearMoverByName(TargetPart, MoverName);

	local MoverAttachment: Attachment = Instance.new('Attachment');
	MoverAttachment.Name = `{MoverName}Attachment`;
	MoverAttachment.Parent = TargetPart;

	local VelocityMover: LinearVelocity = Instance.new('LinearVelocity');
	VelocityMover.Name = MoverName;
	VelocityMover.Attachment0 = MoverAttachment;
	VelocityMover.RelativeTo = (Enum.ActuatorRelativeTo.World);
	VelocityMover.VelocityConstraintMode = (Enum.VelocityConstraintMode.Vector);
	VelocityMover.ForceLimitMode = (Enum.ForceLimitMode.PerAxis);
	VelocityMover.MaxAxesForce = MaxAxesForce or Vector3.new(65000, 65000, 65000);
	VelocityMover.VectorVelocity = InitialVelocity;
	VelocityMover.Parent = TargetPart;

	local Handle: ActiveMoverHandle = {
		AttachmentObject = MoverAttachment,
		VelocityMover    = VelocityMover,
		Destroy          = function(): ()
			if (VelocityMover.Parent) then
				VelocityMover:Destroy();
			end

			if (MoverAttachment.Parent) then
				MoverAttachment:Destroy();
			end

			return;
		end,
	};

	return Handle;
end



local PhysicsImpulse: PhysicsImpulseModule = {
	ApplyImpulse          = ApplyImpulse,
	CreatePersistentMover = CreatePersistentMover,
	ClearMoverByName      = ClearMoverByName,
};



return PhysicsImpulse;
