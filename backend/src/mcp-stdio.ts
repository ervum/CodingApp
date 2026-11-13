#!/usr/bin/env node
/**
 * Standalone Stdio MCP Bridge for RobDev Control Room.
 *
 * Reads newline-delimited JSON-RPC 2.0 messages from stdin, forwards them
 * to the running RobDev backend (`POST /api/mcp`), and writes JSON-RPC
 * responses to stdout.
 */
import * as readline from 'node:readline';

const endpoint =
  process.env.ROBDEV_MCP_URL?.trim() || 'http://localhost:3000/api/mcp';

const rl = readline.createInterface({
  input: process.stdin,
  terminal: false,
});

async function handleLine(line: string): Promise<void> {
  const trimmed = line.trim();
  if (!trimmed) return;

  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const parseErr = {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error' },
    };
    process.stdout.write(`${JSON.stringify(parseErr)}\n`);
    return;
  }

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: trimmed,
    });

    if (res.status === 202 || res.status === 204) {
      return;
    }

    const text = await res.text();
    if (text.trim().length > 0) {
      process.stdout.write(`${text.trim()}\n`);
    }
  } catch (err) {
    const id = parsed && 'id' in parsed ? parsed.id : null;
    if (id !== undefined && id !== null) {
      const rpcErr = {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32603,
          message: `Failed to reach RobDev MCP server at ${endpoint}: ${err instanceof Error ? err.message : String(err)}`,
        },
      };
      process.stdout.write(`${JSON.stringify(rpcErr)}\n`);
    }
  }
}

rl.on('line', (line) => {
  void handleLine(line);
});
