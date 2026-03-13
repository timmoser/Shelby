/**
 * Generic HTTP MCP Proxy — stdio-to-HTTP bridge
 *
 * Runs inside the container as a stdio MCP server (spawned by the Agent SDK).
 * Proxies all tool calls to a remote MCP HTTP server.
 *
 * Environment variables:
 *   MCP_HTTP_URL    — Required. The HTTP endpoint URL.
 *   MCP_HTTP_NAME   — Optional. Server name (default: "http-proxy").
 *   MCP_HTTP_AUTH   — Optional. Authorization header value.
 *
 * On startup:
 *   1. Initializes an MCP session with the remote HTTP server
 *   2. Fetches the tool list
 *   3. Registers each tool locally as a stdio MCP tool
 *   4. Forwards invocations to the HTTP endpoint and returns results
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const MCP_URL = process.env.MCP_HTTP_URL;
const MCP_NAME = process.env.MCP_HTTP_NAME || 'http-proxy';
const MCP_AUTH = process.env.MCP_HTTP_AUTH;

if (!MCP_URL) {
  process.stderr.write('MCP_HTTP_URL not set, exiting\n');
  process.exit(1);
}

/** MCP JSON-RPC request helper */
let rpcId = 1;
async function mcpRequest(method: string, params?: unknown): Promise<unknown> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (MCP_AUTH) {
    headers['Authorization'] = MCP_AUTH;
  }
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: rpcId++,
    method,
    params: params ?? {},
  });
  const res = await fetch(MCP_URL!, { method: 'POST', headers, body });
  if (!res.ok) {
    throw new Error(`${MCP_NAME} HTTP ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as {
    result?: unknown;
    error?: { message: string };
  };
  if (json.error) {
    throw new Error(`${MCP_NAME} error: ${json.error.message}`);
  }
  return json.result;
}

interface McpToolDef {
  name: string;
  description?: string;
  inputSchema?: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

async function main() {
  // Initialize MCP session
  await mcpRequest('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: `nanoclaw-${MCP_NAME}-proxy`, version: '1.0.0' },
  });

  // Fetch available tools
  const listResult = (await mcpRequest('tools/list')) as {
    tools: McpToolDef[];
  };
  const tools = listResult.tools;

  if (!tools || tools.length === 0) {
    process.stderr.write(`${MCP_NAME} proxy: no tools available\n`);
    process.exit(1);
  }

  process.stderr.write(`${MCP_NAME} MCP proxy: ${tools.length} tools loaded\n`);

  const server = new McpServer({ name: MCP_NAME, version: '1.0.0' });

  for (const tool of tools) {
    const toolName = tool.name;
    server.tool(
      toolName,
      tool.description || '',
      { _params: z.any().optional().describe('Tool parameters') },
      async (
        args,
      ): Promise<{
        content: Array<{ type: 'text'; text: string }>;
        isError?: boolean;
      }> => {
        try {
          const params = args._params ?? args;
          const result = await mcpRequest('tools/call', {
            name: toolName,
            arguments: params,
          });
          const callResult = result as {
            content?: Array<{ type: string; text?: string }>;
          };
          if (callResult.content) {
            return {
              content: callResult.content.map((c) => ({
                type: 'text' as const,
                text: c.text ?? JSON.stringify(c),
              })),
            };
          }
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result) }],
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: 'text' as const, text: `Error: ${message}` }],
            isError: true,
          };
        }
      },
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`${MCP_NAME} proxy fatal: ${err}\n`);
  process.exit(1);
});
