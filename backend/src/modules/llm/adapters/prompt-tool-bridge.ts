import type {
  LlmImageAttachment,
  LlmMessage,
  LlmToolCall,
  LlmToolDef,
} from './llm-adapter.interface.js';

const TOOL_CALL_REGEX = /<tool_call>\s*([\s\S]*?)\s*(?:<\/tool_call>|<\/tool>)/gi;
const UNCLOSED_TOOL_CALL_TAIL_REGEX = /<tool_call>\s*(\{[\s\S]*\}\s*\})\s*$/i;

export interface ExtractedToolCallsResult {
  cleanText: string;
  toolCalls: LlmToolCall[];
}

export class PromptToolBridge {
  /**
   * Strips completed `<tool_call>...</tool_call>` blocks and holds back any in-progress
   * `<tool_call` or trailing partial tag prefix (`<`, `<t`, `<to`, `<too`, `<tool`, ```` ```xml ````)
   * so web-UI streaming adapters never leak a stray `<` into the chat message bubble.
   */
  static computeStreamableText(rawText: string): string {
    let cleaned = rawText
      .replace(
        /```(?:xml|json|tool_call)?\s*<tool_call>[\s\S]*?(?:<\/tool_call>|<\/tool>)\s*```/gi,
        '',
      )
      .replace(/<tool_call>[\s\S]*?(?:<\/tool_call>|<\/tool>)/gi, '');

    const unclosedIdx = cleaned.search(
      /```(?:xml|json|tool_call)?\s*<tool_call|<tool_call|(?:```(?:xml|json|tool_call)?\s*)?<\/?(?:t(?:o(?:o(?:l(?:_[a-z_]*)?)?)?)?)?$/i,
    );
    if (unclosedIdx >= 0) {
      cleaned = cleaned.slice(0, unclosedIdx);
    }
    return cleaned.trimEnd();
  }

  static injectToolsIntoMessages(
    messages: LlmMessage[],
    tools: LlmToolDef[],
    compactForGuest = false,
  ): LlmMessage[] {
    if (tools.length === 0) {
      return messages.map((m) => this.flattenToolMessage(m));
    }

    const toolSpecLines = tools.map((t) =>
      JSON.stringify({
        name: t.name,
        description: t.description,
        parameters: compactForGuest
          ? this.compactSchema(t.parameters)
          : t.parameters,
      }),
    );

    const instructions = [
      '',
      '## Available Studio Tools (XML <tool_call> Text Tag Protocol)',
      'You have access to the following tools. Whenever you need to invoke one or more tools, ALWAYS wrap each `<tool_call>...</tool_call>` block inside a fenced ```xml code block so Markdown never alters quotes or underscores, and escape any double quotes inside JSON string values as `\\"`:',
      '```xml',
      '<tool_call>{"name": "tool_name", "arguments": {"key": "value"}}</tool_call>',
      '```',
      '- CRITICAL: Do NOT invoke native `google:*` function calls or built-in tool declarations. Always write `<tool_call>...</tool_call>` inside a ```xml code block in your response.',
      'Available tool definitions:',
      ...toolSpecLines.map((line) => `- ${line}`),
      '',
      'IMPORTANT INTERLEAVED TOOL PROTOCOL:',
      '- Whenever you emit a `<tool_call>` block to observe the screen or windows (`pc_observe`, `pc_window`, `pc_sandbox`), read a file (`read_workspace_file`, `studio_read_script`), search (`grep_workspace`, `list_workspace_files`, `studio_inspect_tree`, `vault_search`), or run diagnostics (`studio_run_diagnostics`), STOP IMMEDIATELY after `</tool_call>` and wait for the `[TOOL_RESULT]` message in the next turn before answering or writing dependent code.',
      '- Note: `pc_observe` on `MAIN_PC` automatically captures a live screenshot AND returns `openWindows` (all visible top-level windows with titles and process names) plus interactive `elements` and `ocrText`. You may also call `pc_window` in the same turn if needed.',
      '- When delegating multiple tasks via `delegate_task` (e.g. to `builder` and `reviewer`), you may emit all `delegate_task` `<tool_call>` blocks in the same response (use `dependsOnTaskIds: ["builder"]` or `["task_1"]` to order dependent tasks), and then stop and wait for `[TOOL_RESULT]`.',
    ].join('\n');

    const result: LlmMessage[] = [];
    let injectedIntoSystem = false;

    for (const msg of messages) {
      if (msg.role === 'system' && !injectedIntoSystem) {
        injectedIntoSystem = true;
        result.push({
          role: 'system',
          content: `${msg.content}\n${instructions}`,
        });
      } else {
        result.push(this.flattenToolMessage(msg));
      }
    }

    if (!injectedIntoSystem) {
      result.unshift({
        role: 'system',
        content: instructions.trim(),
      });
    }

    return result;
  }

  static flattenToolMessage(msg: LlmMessage): LlmMessage {
    if (msg.role === 'tool') {
      let formattedBody = msg.content;
      if (
        msg.name === 'read_workspace_file' ||
        msg.name === 'studio_read_script'
      ) {
        try {
          const parsed = JSON.parse(msg.content) as Record<string, unknown>;
          if (
            parsed &&
            parsed['ok'] === true &&
            typeof parsed['contentWithLineNumbers'] === 'string'
          ) {
            const {
              contentWithLineNumbers,
              rawContent: _raw,
              ...meta
            } = parsed;
            formattedBody = `${JSON.stringify(meta)}\n${contentWithLineNumbers}`;
          }
        } catch {
          // keep original msg.content
        }
      }
      const imageAttachmentNote =
        msg.images && msg.images.length > 0
          ? `\n[Attached live screenshot image (${msg.images[0]?.width ?? '?'}x${msg.images[0]?.height ?? '?'} PNG) — inspect the attached image and the JSON payload above to describe what is visible on screen and which windows/applications are open.]`
          : '';
      return {
        role: 'user',
        content: `[TOOL_RESULT name="${msg.name}" id="${msg.toolCallId}"]\n${formattedBody}${imageAttachmentNote}`,
        ...(msg.images && msg.images.length > 0 ? { images: msg.images } : {}),
      };
    }
    if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
      const serializedCalls = msg.toolCalls
        .map(
          (tc) =>
            `<tool_call>${JSON.stringify({
              name: tc.name,
              arguments: this.safeParseJson(tc.argumentsJson),
            })}</tool_call>`,
        )
        .join('\n');
      return {
        role: 'assistant',
        content: [msg.content, serializedCalls].filter(Boolean).join('\n'),
      };
    }
    return msg;
  }

  static extractToolCallsFromText(rawText: string): ExtractedToolCallsResult {
    const toolCalls: LlmToolCall[] = [];
    let index = 0;

    let cleanText = rawText
      .replace(TOOL_CALL_REGEX, (_fullMatch, innerJson: string) => {
        const parsed = this.parseToolPayload(innerJson);
        if (parsed) {
          index += 1;
          toolCalls.push({
            id: `prompt_call_${Date.now()}_${index}`,
            name: parsed.name,
            argumentsJson: JSON.stringify(parsed.arguments),
          });
        }
        return '';
      })
      .trim();

    if (toolCalls.length === 0 && UNCLOSED_TOOL_CALL_TAIL_REGEX.test(cleanText)) {
      cleanText = cleanText
        .replace(UNCLOSED_TOOL_CALL_TAIL_REGEX, (_m, innerJson: string) => {
          const parsed = this.parseToolPayload(innerJson);
          if (parsed) {
            index += 1;
            toolCalls.push({
              id: `prompt_call_${Date.now()}_${index}`,
              name: parsed.name,
              argumentsJson: JSON.stringify(parsed.arguments),
            });
          }
          return '';
        })
        .trim();
    }

    // Strip any leftover empty ```xml / ```json fences that wrapped the <tool_call>
    cleanText = cleanText
      .replace(/```(?:xml|json|tool_call)?\s*```/gi, '')
      .trim();

    return { cleanText, toolCalls };
  }

  static containsInspectionToolCall(rawText: string): boolean {
    if (!rawText.includes('</tool_call>')) return false;
    const { toolCalls } = this.extractToolCallsFromText(rawText);
    const inspectionTools = new Set([
      'pc_observe',
      'pc_window',
      'pc_sandbox',
      'studio_direct',
      'read_workspace_file',
      'list_workspace_files',
      'grep_workspace',
      'run_terminal_command',
      'studio_inspect_tree',
      'studio_read_script',
      'studio_run_diagnostics',
      'studio_run_playtest',
      'vault_search',
      'vault_read',
      'market_query',
    ]);
    return toolCalls.some((tc) => inspectionTools.has(tc.name));
  }

  static truncateAfterLastToolCall(rawText: string): string {
    const closeTag = '</tool_call>';
    const lastIdx = rawText.toLowerCase().lastIndexOf(closeTag);
    if (lastIdx < 0) return rawText;
    return rawText.slice(0, lastIdx + closeTag.length);
  }

  static formatSinglePromptForWebUi(
    messages: LlmMessage[],
    tools: LlmToolDef[],
    compactForGuest = false,
  ): string {
    const bridged = this.injectToolsIntoMessages(messages, tools, compactForGuest);
    return bridged
      .map((m) => {
        if (m.role === 'system') {
          return `[SYSTEM INSTRUCTIONS]\n${m.content}`;
        }
        if (m.role === 'assistant') {
          return `[ASSISTANT]\n${m.content}`;
        }
        return `[USER]\n${m.content}`;
      })
      .join('\n\n---\n\n');
  }

  /**
   * Formats only the new tool-result / user messages added after the latest assistant turn
   * so an open web chat tab can continue the conversation in-place without re-sending the entire prompt.
   */
  static formatFollowUpTurnForWebUi(messages: LlmMessage[]): string {
    let lastAssistantIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === 'assistant') {
        lastAssistantIdx = i;
        break;
      }
    }

    const trailing =
      lastAssistantIdx >= 0 ? messages.slice(lastAssistantIdx + 1) : messages;
    const lines = trailing.map((m) => this.flattenToolMessage(m).content);

    return [
      ...lines,
      '',
      'All tool results above have been recorded (and any captured screenshot is displayed in the user chat and attached above). If you still need to invoke another tool (such as `pc_window`, `delegate_task`, `edit_workspace_file`, `save_artifact`, or `studio_run_diagnostics`), emit that `<tool_call>` block now. Otherwise, directly and thoroughly answer the user\'s request using the tool results and screenshot above (for example, listing all open windows/applications and describing what is currently visible on the screen).',
    ].join('\n\n');
  }

  /**
   * Returns any images attached to tool/user messages after the latest assistant turn
   * so web browser adapters can paste screenshots directly into the chat composer.
   */
  static extractTrailingImagesForWebUi(
    messages: LlmMessage[],
  ): LlmImageAttachment[] {
    let lastAssistantIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === 'assistant') {
        lastAssistantIdx = i;
        break;
      }
    }
    const trailing =
      lastAssistantIdx >= 0 ? messages.slice(lastAssistantIdx + 1) : messages;
    const images: LlmImageAttachment[] = [];
    for (const msg of trailing) {
      if (
        (msg.role === 'tool' || msg.role === 'user') &&
        msg.images &&
        msg.images.length > 0
      ) {
        images.push(...msg.images);
      }
    }
    return images;
  }

  /**
   * Formats a follow-up user prompt for an existing Gemini Web / AI Studio chat session
   * when continuing the chat on a new run or follow-up user message (`turnIndex === 0`).
   * Also includes any unanswered `[TOOL_RESULT]` messages recovered from a preceding run
   * so typing "Continue" after a stalled tool turn sends both the tool results and the user message.
   */
  static formatFollowUpUserPromptForWebUi(
    messages: LlmMessage[],
    includeTaskHeader = false,
  ): string {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastUserMsg) {
      return '';
    }
    const raw = lastUserMsg.content.trim();
    let userBody = raw;
    if (!includeTaskHeader && raw.startsWith('[TASK]')) {
      const lines = raw.split('\n');
      const blankIdx = lines.findIndex((l, idx) => idx > 0 && l.trim() === '');
      if (blankIdx >= 0 && blankIdx + 1 < lines.length) {
        const body = lines
          .slice(blankIdx + 1)
          .filter(
            (l) =>
              l.trim() !== 'The human replied — continue from where you stopped.',
          )
          .join('\n')
          .trim();
        if (body) {
          userBody = body;
        }
      }
    }

    const pendingToolMessages = messages.filter((m) => m.role === 'tool');
    if (pendingToolMessages.length > 0) {
      const formattedToolResults = pendingToolMessages.map(
        (m) => this.flattenToolMessage(m).content,
      );
      return [
        ...formattedToolResults,
        '',
        userBody,
        '',
        'All tool results above have been recorded. Continue from where you stopped using these tool results.',
      ].join('\n\n');
    }

    return userBody;
  }

  private static compactSchema(
    schema: Record<string, unknown>,
  ): Record<string, unknown> {
    const propsRaw = schema['properties'];
    const requiredRaw = schema['required'];
    if (typeof propsRaw !== 'object' || propsRaw === null) {
      return schema;
    }
    const compactProps: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(propsRaw as Record<string, unknown>)) {
      if (typeof val === 'object' && val !== null) {
        const v = val as Record<string, unknown>;
        compactProps[key] = {
          type: v['type'],
          ...(v['enum'] ? { enum: v['enum'] } : {}),
          ...(v['description'] ? { description: v['description'] } : {}),
        };
      }
    }
    return {
      type: 'object',
      properties: compactProps,
      ...(Array.isArray(requiredRaw) ? { required: requiredRaw } : {}),
    };
  }

  private static parseToolPayload(
    raw: string,
  ): { name: string; arguments: Record<string, unknown> } | null {
    const trimmed = raw
      .trim()
      .replace(/^```(?:json|xml)?\s*/i, '')
      .replace(/\s*```$/, '');
    const repairedQuotes = this.repairUnescapedQuotesInJsonStrings(trimmed);
    const candidates = [
      trimmed,
      this.escapeControlCharsInJsonStrings(trimmed),
      repairedQuotes,
      this.escapeControlCharsInJsonStrings(repairedQuotes),
    ];
    for (const candidate of candidates) {
      try {
        const obj = JSON.parse(candidate) as unknown;
        if (
          typeof obj === 'object' &&
          obj !== null &&
          'name' in obj &&
          typeof (obj as { name: unknown }).name === 'string'
        ) {
          const name = (obj as { name: string }).name.trim();
          const argsRaw =
            (obj as { arguments?: unknown; args?: unknown }).arguments ??
            (obj as { args?: unknown }).args ??
            {};
          const args =
            typeof argsRaw === 'object' && argsRaw !== null && !Array.isArray(argsRaw)
              ? (argsRaw as Record<string, unknown>)
              : {};
          return {
            name,
            arguments: this.normalizeExtractedToolArguments(name, args),
          };
        }
      } catch {
        // try next candidate
      }
    }

    const salvaged = this.salvageToolPayloadByKeys(trimmed);
    if (salvaged) {
      return {
        name: salvaged.name,
        arguments: this.normalizeExtractedToolArguments(
          salvaged.name,
          salvaged.arguments,
        ),
      };
    }

    return null;
  }

  /**
   * Repairs unescaped double quotes inside JSON string values (e.g. when AI Studio's Markdown
   * parser unescapes `\"` -> `"` inside an unfenced `<tool_call>` block such as
   * `"content": "def main() -> None:\n print("Hello World")\n"`).
   */
  private static repairUnescapedQuotesInJsonStrings(input: string): string {
    let out = '';
    let inString = false;
    let stringRole: 'key' | 'value' = 'key';
    let expectingKey = true;
    let escaped = false;

    for (let i = 0; i < input.length; i++) {
      const ch = input[i]!;
      if (escaped) {
        out += ch;
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        out += ch;
        escaped = true;
        continue;
      }
      if (!inString) {
        if (ch === '{') {
          expectingKey = true;
        } else if (ch === ':') {
          expectingKey = false;
        } else if (ch === ',') {
          // After a comma inside an object, check if the next token is `"key":`
          const restAfterComma = input.slice(i + 1);
          if (/^\s*"[a-zA-Z_][a-zA-Z0-9_]*"\s*:/.test(restAfterComma)) {
            expectingKey = true;
          }
        } else if (ch === '"') {
          inString = true;
          stringRole = expectingKey ? 'key' : 'value';
        }
        out += ch;
        continue;
      }

      // Inside a JSON string
      if (ch === '"') {
        const rest = input.slice(i + 1);
        if (stringRole === 'key') {
          if (/^\s*:/.test(rest)) {
            inString = false;
            out += ch;
            continue;
          }
          out += '\\"';
          continue;
        }

        // stringRole === 'value': a closing quote is only valid if followed by:
        // - `, "<nextKey>":` (next property in object)
        // - `}` followed by `,`, `}`, `]`, or end-of-string
        // - `]` followed by `,`, `}`, `]`, or end-of-string
        const isClosingValueQuote =
          /^\s*,\s*"[a-zA-Z_][a-zA-Z0-9_]*"\s*:/.test(rest) ||
          /^\s*\}\s*(?:,|\}|\]|$)/.test(rest) ||
          /^\s*\]\s*(?:,|\}|\]|$)/.test(rest);

        if (isClosingValueQuote) {
          inString = false;
          out += ch;
        } else {
          out += '\\"';
        }
        continue;
      }

      out += ch;
    }

    return out;
  }

  /**
   * Fallback key-boundary parser if `<tool_call>` JSON is still malformed.
   */
  private static salvageToolPayloadByKeys(
    raw: string,
  ): { name: string; arguments: Record<string, unknown> } | null {
    const nameMatch = /"name"\s*:\s*"([a-zA-Z0-9_]+)"/.exec(raw);
    if (!nameMatch?.[1]) return null;
    const name = nameMatch[1].trim();

    const argsIdx = raw.search(/"(?:arguments|args)"\s*:\s*\{/);
    if (argsIdx < 0) return { name, arguments: {} };

    const argsOpenBrace = raw.indexOf('{', argsIdx);
    const argsCloseBrace = raw.lastIndexOf('}', raw.lastIndexOf('}') - 1);
    const argsBody =
      argsOpenBrace >= 0 && argsCloseBrace > argsOpenBrace
        ? raw.slice(argsOpenBrace + 1, argsCloseBrace)
        : raw.slice(argsOpenBrace + 1);

    const keyBoundaryRegex = /(?:^|,\s*)"([a-zA-Z_][a-zA-Z0-9_]*)"\s*:\s*/g;
    const keys: Array<{ key: string; matchStart: number; valStart: number }> = [];
    let m: RegExpExecArray | null;
    while ((m = keyBoundaryRegex.exec(argsBody)) !== null) {
      keys.push({
        key: m[1]!,
        matchStart: m.index,
        valStart: m.index + m[0].length,
      });
    }

    const args: Record<string, unknown> = {};
    for (let idx = 0; idx < keys.length; idx++) {
      const curr = keys[idx]!;
      const next = keys[idx + 1];
      const rawVal = (
        next
          ? argsBody.slice(curr.valStart, next.matchStart)
          : argsBody.slice(curr.valStart)
      ).trim();

      if (rawVal.startsWith('"') && rawVal.endsWith('"')) {
        const inner = rawVal
          .slice(1, -1)
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\r')
          .replace(/\\t/g, '\t')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\');
        args[curr.key] = inner;
      } else if (rawVal === 'true') {
        args[curr.key] = true;
      } else if (rawVal === 'false') {
        args[curr.key] = false;
      } else if (/^-?\d+(?:\.\d+)?$/.test(rawVal)) {
        args[curr.key] = Number(rawVal);
      } else {
        try {
          args[curr.key] = JSON.parse(rawVal);
        } catch {
          args[curr.key] = rawVal.replace(/^"|"$/g, '');
        }
      }
    }

    return { name, arguments: args };
  }

  /**
   * Restores Markdown-mangled Python dunders (e.g. `if name == "main":` or `if **name** == "**main**":`
   * -> `if __name__ == "__main__":`) and 1-space collapsed indentation when a web UI rendered
   * `<tool_call>` outside a fenced code block.
   */
  private static normalizeExtractedToolArguments(
    toolName: string,
    args: Record<string, unknown>,
  ): Record<string, unknown> {
    if (toolName === 'delegate_task') {
      const next = { ...args };
      if (typeof next['agentKey'] === 'string') {
        next['agentKey'] = next['agentKey'].trim().toLowerCase();
      }
      if (typeof next['priority'] === 'string') {
        next['priority'] = next['priority'].trim().toUpperCase();
      }
      if (next['dependsOnTaskIds'] === undefined && next['dependsOn'] !== undefined) {
        next['dependsOnTaskIds'] = next['dependsOn'];
        delete next['dependsOn'];
      }
      if (Array.isArray(next['dependsOnTaskIds'])) {
        next['dependsOnTaskIds'] = next['dependsOnTaskIds'].map((v) => String(v));
      } else if (typeof next['dependsOnTaskIds'] === 'string' && next['dependsOnTaskIds'].trim()) {
        next['dependsOnTaskIds'] = [next['dependsOnTaskIds'].trim()];
      }
      return next;
    }

    if (toolName !== 'save_artifact' && toolName !== 'edit_workspace_file') {
      return args;
    }
    const pathStr = typeof args['path'] === 'string' ? args['path'] : '';
    const langStr = typeof args['language'] === 'string' ? args['language'] : '';
    const isPython =
      /^python|py$/i.test(langStr.trim()) || /\.py$/i.test(pathStr.trim());
    if (!isPython) {
      return args;
    }

    const fixPythonCode = (code: string): string => {
      let fixed = code
        // Restore `if name == "main":` or `if **name** == "**main**":` -> `if __name__ == "__main__":`
        .replace(
          /\bif\s+(?:\*\*|__)?name(?:\*\*|__)?\s*==\s*(["'])(?:\*\*|__)?main(?:\*\*|__)?\1\s*:/g,
          'if __name__ == $1__main__$1:',
        )
        // Restore common Python dunder methods (`def init(self` / `def **init**(self` -> `def __init__(self`)
        .replace(
          /\bdef\s+(?:\*\*|__)?(init|new|del|repr|str|bytes|format|lt|le|eq|ne|gt|ge|hash|bool|len|getitem|setitem|delitem|iter|next|contains|enter|exit|call|post_init)(?:\*\*|__)?\s*\(/g,
          'def __$1__(',
        );

      // If Markdown collapsed 4-space indentation to 1-space indentation (every indented line starts with a single space)
      const lines = fixed.split('\n');
      const indentedLines = lines.filter((l) => /^[ ]+\S/.test(l));
      if (
        indentedLines.length > 0 &&
        indentedLines.every((l) => /^ \S/.test(l))
      ) {
        fixed = lines
          .map((l) => (/^ \S/.test(l) ? `    ${l.slice(1)}` : l))
          .join('\n');
      }
      return fixed;
    };

    const nextArgs = { ...args };
    if (typeof nextArgs['content'] === 'string') {
      nextArgs['content'] = fixPythonCode(nextArgs['content']);
    }
    if (typeof nextArgs['replacement'] === 'string') {
      nextArgs['replacement'] = fixPythonCode(nextArgs['replacement']);
    }
    return nextArgs;
  }

  private static escapeControlCharsInJsonStrings(input: string): string {
    let out = '';
    let inString = false;
    let escaped = false;
    for (let i = 0; i < input.length; i++) {
      const ch = input[i]!;
      if (escaped) {
        out += ch;
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        out += ch;
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        out += ch;
        continue;
      }
      if (inString) {
        if (ch === '\n') {
          out += '\\n';
          continue;
        }
        if (ch === '\r') {
          out += '\\r';
          continue;
        }
        if (ch === '\t') {
          out += '\\t';
          continue;
        }
      }
      out += ch;
    }
    return out;
  }

  private static safeParseJson(json: string): Record<string, unknown> {
    try {
      const parsed = JSON.parse(json) as unknown;
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // ignore
    }
    return {};
  }
}

export function injectToolsIntoMessages(
  messages: LlmMessage[],
  tools: LlmToolDef[],
  compactForGuest = false,
): LlmMessage[] {
  return PromptToolBridge.injectToolsIntoMessages(messages, tools, compactForGuest);
}

export function extractToolCallsFromText(rawText: string): ExtractedToolCallsResult {
  return PromptToolBridge.extractToolCallsFromText(rawText);
}

export function formatSinglePromptForWebUi(
  messages: LlmMessage[],
  toolsOrHasTools: LlmToolDef[] | boolean = [],
  compactForGuest = false,
): string {
  const tools = Array.isArray(toolsOrHasTools) ? toolsOrHasTools : [];
  return PromptToolBridge.formatSinglePromptForWebUi(messages, tools, compactForGuest);
}

export function formatFollowUpTurnForWebUi(messages: LlmMessage[]): string {
  return PromptToolBridge.formatFollowUpTurnForWebUi(messages);
}

export function formatFollowUpUserPromptForWebUi(
  messages: LlmMessage[],
  includeTaskHeader = false,
): string {
  return PromptToolBridge.formatFollowUpUserPromptForWebUi(messages, includeTaskHeader);
}

