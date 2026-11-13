import { describe, expect, it } from 'vitest';
import { CreatePlaybookSchema, validatePlaybookStepsAcyclic } from './playbook.schema.js';

describe('PlaybookStepSchema & validatePlaybookStepsAcyclic', () => {
  it('accepts a valid DAG of steps', () => {
    const res = CreatePlaybookSchema.safeParse({
      key: 'vertical-slice',
      name: 'New Game Vertical Slice',
      description: 'Draft blueprint, build systems, and verify playtest.',
      steps: [
        {
          key: 'blueprint',
          agentKey: 'architect',
          title: 'Write 12-step blueprint',
          brief: 'Author the 12-step architecture blueprint in the Knowledge Vault.',
          dependsOn: [],
          priority: 'HIGH',
        },
        {
          key: 'build-core',
          agentKey: 'builder',
          title: 'Build core loop systems',
          brief: 'Implement the core Luau server and client modules according to blueprint.',
          dependsOn: ['blueprint'],
          priority: 'HIGH',
        },
        {
          key: 'playtest-pass',
          agentKey: 'playtest',
          title: 'Run multiplayer & save recovery pass',
          brief: 'Acquire a Studio lane, run diagnostics and playtest on the new build.',
          dependsOn: ['build-core'],
          priority: 'NORMAL',
        },
      ],
      suggestOnGameStatus: 'BLUEPRINT',
    });
    expect(res.success).toBe(true);
  });

  it('rejects unknown dependency step keys', () => {
    const check = validatePlaybookStepsAcyclic([
      {
        key: 'step-a',
        agentKey: 'builder',
        title: 'Build system',
        brief: 'Implement the core Luau server and client modules.',
        dependsOn: ['missing-step'],
        priority: 'NORMAL',
      },
    ]);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.message).toContain('unknown step "missing-step"');
    }
  });

  it('rejects direct self-dependencies and multi-step cycles', () => {
    const selfCycle = validatePlaybookStepsAcyclic([
      {
        key: 'step-a',
        agentKey: 'builder',
        title: 'Build system',
        brief: 'Implement the core Luau server and client modules.',
        dependsOn: ['step-a'],
        priority: 'NORMAL',
      },
    ]);
    expect(selfCycle.ok).toBe(false);

    const twoNodeCycle = validatePlaybookStepsAcyclic([
      {
        key: 'step-a',
        agentKey: 'architect',
        title: 'Design system',
        brief: 'Write the technical specification for the game.',
        dependsOn: ['step-b'],
        priority: 'NORMAL',
      },
      {
        key: 'step-b',
        agentKey: 'builder',
        title: 'Build system',
        brief: 'Implement the core Luau server and client modules.',
        dependsOn: ['step-a'],
        priority: 'NORMAL',
      },
    ]);
    expect(twoNodeCycle.ok).toBe(false);
    if (!twoNodeCycle.ok) {
      expect(twoNodeCycle.message).toContain('Cycle detected');
    }
  });
});
