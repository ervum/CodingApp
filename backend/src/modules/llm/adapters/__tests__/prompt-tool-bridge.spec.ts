import { describe, expect, it } from 'vitest';
import { PromptToolBridge } from '../prompt-tool-bridge.js';

describe('PromptToolBridge', () => {
  it('parses AI Studio <tool_call> blocks where Markdown unescaped inner quotes and mangled Python dunders', () => {
    const aiStudioRaw =
      '<tool_call>{"name": "save_artifact", "arguments": {"path": "hello_bye.py", "language": "python", "content": "def main() -> None:\\n print("Hello World")\\n print("Bye World")\\n\\n\\nif name == "main":\\n main()\\n", "comment": "Python script that prints \'Hello World\' and \'Bye World\' to standard output."}}</tool_call>';

    const result = PromptToolBridge.extractToolCallsFromText(aiStudioRaw);
    expect(result.cleanText).toBe('');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]?.name).toBe('save_artifact');

    const args = JSON.parse(result.toolCalls[0]!.argumentsJson) as {
      path: string;
      language: string;
      content: string;
      comment: string;
    };
    expect(args.path).toBe('hello_bye.py');
    expect(args.language).toBe('python');
    expect(args.content).toContain('    print("Hello World")');
    expect(args.content).toContain('    print("Bye World")');
    expect(args.content).toContain('if __name__ == "__main__":');
    expect(args.comment).toContain("prints 'Hello World' and 'Bye World'");
  });

  it('holds back trailing partial < and <tool_call prefixes during streaming', () => {
    expect(PromptToolBridge.computeStreamableText('<')).toBe('');
    expect(PromptToolBridge.computeStreamableText('<t')).toBe('');
    expect(PromptToolBridge.computeStreamableText('<tool')).toBe('');
    expect(PromptToolBridge.computeStreamableText('<tool_call')).toBe('');
    expect(PromptToolBridge.computeStreamableText('```xml\n<')).toBe('');
    expect(
      PromptToolBridge.computeStreamableText(
        'Checking requirements...\n<tool_call>{"name": "save_artifact"}',
      ),
    ).toBe('Checking requirements...');
  });
});
