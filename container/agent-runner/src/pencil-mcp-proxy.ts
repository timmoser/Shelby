/**
 * Pencil MCP Proxy — thin wrapper around the generic HTTP MCP proxy.
 * Sets the env vars and imports the generic proxy.
 */
process.env.MCP_HTTP_URL = process.env.PENCIL_MCP_URL;
process.env.MCP_HTTP_NAME = 'pencil';
import('./http-mcp-proxy.js');
