import { describe, expect, it } from 'vitest';
import { PromptToolBridge } from './prompt-tool-bridge.js';

describe('PromptToolBridge', () => {
  it('injects tool schemas into the system message and flattens tool results', () => {
    const messages = PromptToolBridge.injectToolsIntoMessages(
      [
        { role: 'system', content: 'You are Lead.' },
        { role: 'user', content: 'Build a sword combat prototype.' },
        {
          role: 'tool',
          toolCallId: 'call_1',
          name: 'vault_search',
          content: '{"hits":[]}',
        },
      ],
      [
        {
          name: 'delegate_task',
          description: 'Delegate work to a specialist agent',
          parameters: { type: 'object', properties: { agentKey: { type: 'string' } } },
        },
      ],
    );

    expect(messages[0]?.role).toBe('system');
    expect(messages[0]?.content).toContain('delegate_task');
    expect(messages[2]?.role).toBe('user');
    expect(messages[2]?.content).toContain('[TOOL_RESULT name="vault_search"');
  });

  it('extracts single and multiple <tool_call> blocks and strips them from visible text', () => {
    const raw = `I will delegate the blueprint to Architect and query the vault.
<tool_call>{"name": "delegate_task", "arguments": {"agentKey": "architect", "title": "12-Step Blueprint"}}</tool_call>
<tool_call>
\`\`\`json
{"name": "vault_search", "arguments": {"query": "combat"}}
\`\`\`
</tool_call>`;

    const res = PromptToolBridge.extractToolCallsFromText(raw);
    expect(res.cleanText).toBe('I will delegate the blueprint to Architect and query the vault.');
    expect(res.toolCalls).toHaveLength(2);
    expect(res.toolCalls[0]?.name).toBe('delegate_task');
    expect(JSON.parse(res.toolCalls[0]?.argumentsJson ?? '{}')).toEqual({
      agentKey: 'architect',
      title: '12-Step Blueprint',
    });
    expect(res.toolCalls[1]?.name).toBe('vault_search');
  });

  it('formats follow-up tool turns without re-sending the system prompt or prior turns', () => {
    const followUp = PromptToolBridge.formatFollowUpTurnForWebUi([
      { role: 'system', content: 'Huge system prompt that must not be repeated' },
      { role: 'user', content: 'Initial user brief' },
      {
        role: 'assistant',
        content: 'Delegating to Architect.',
        toolCalls: [{ id: 'c1', name: 'delegate_task', argumentsJson: '{}' }],
      },
      {
        role: 'tool',
        toolCallId: 'c1',
        name: 'delegate_task',
        content: '{"ok":true,"taskId":"t_123","agentKey":"architect"}',
      },
    ]);

    expect(followUp).not.toContain('Huge system prompt');
    expect(followUp).toContain('[TOOL_RESULT name="delegate_task" id="c1"]');
    expect(followUp).toContain('"taskId":"t_123"');
  });

  it('formats follow-up user prompts when continuing an existing web chat', () => {
    const messages = [
      { role: 'system' as const, content: 'System preamble' },
      { role: 'user' as const, content: '[CONTEXT]\nStudio: Inclined Games' },
      {
        role: 'user' as const,
        content:
          '[TASK]\nTitle: Build coin system\nPriority: NORMAL\nTags: none\n\nNow add a shop UI for those coins.',
      },
    ];

    expect(PromptToolBridge.formatFollowUpUserPromptForWebUi(messages, false)).toBe(
      'Now add a shop UI for those coins.',
    );
    expect(PromptToolBridge.formatFollowUpUserPromptForWebUi(messages, true)).toContain(
      '[TASK]\nTitle: Build coin system',
    );
  });

  it('detects inspection tool calls and truncates speculative text after </tool_call>', () => {
    const raw = `Let me inspect the existing CombatClient first.
<tool_call>{"name": "read_workspace_file", "arguments": {"path": "Game/StarterPlayer/StarterPlayerScripts/CombatClient/Source.client.luau"}}</tool_call>
Assuming the file contains a basic loop, here is what I think it does...`;

    expect(PromptToolBridge.containsInspectionToolCall(raw)).toBe(true);
    const truncated = PromptToolBridge.truncateAfterLastToolCall(raw);
    expect(truncated).not.toContain('Assuming the file contains');
    expect(truncated.endsWith('</tool_call>')).toBe(true);
  });

  it('unwraps read_workspace_file tool results into compact unescaped numbered lines', () => {
    const flattened = PromptToolBridge.flattenToolMessage({
      role: 'tool',
      toolCallId: 'call_read_1',
      name: 'read_workspace_file',
      content: JSON.stringify({
        ok: true,
        path: 'Game/ServerScriptService/CombatServer/Source.server.luau',
        sourceRoot: 'silicon',
        totalLines: 2,
        startLine: 1,
        endLine: 2,
        contentWithLineNumbers: '1: --!strict\n2: local x: number = 1;',
      }),
    });

    expect(flattened.content).toContain(
      '[TOOL_RESULT name="read_workspace_file" id="call_read_1"]',
    );
    expect(flattened.content).toContain('\n1: --!strict\n2: local x: number = 1;');
    expect(flattened.content).not.toContain('contentWithLineNumbers');
  });
});
