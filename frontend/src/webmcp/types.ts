/**
 * Ambient types for the WebMCP browser API (`document.modelContext`).
 *
 * WebMCP is an origin trial as of Chrome 149 / Edge 150, so it is absent from
 * `lib.dom`. These declarations follow the explainer at
 * https://github.com/webmachinelearning/webmcp and cover only what this app
 * calls. `modelContext` is optional on purpose: on any browser without the
 * trial enabled it is simply undefined, and the registration path has to treat
 * that as the normal case rather than an error.
 */

/** One block of an MCP-shaped tool result. */
export interface ToolContentBlock {
  type: "text";
  text: string;
}

/** What a tool's `execute` callback hands back to the agent. */
export interface ToolResult {
  content: ToolContentBlock[];
  isError?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the tool's arguments. */
  inputSchema?: Record<string, unknown>;
  execute: (args: Record<string, unknown>, options?: { signal?: AbortSignal }) => Promise<ToolResult>;
}

export interface RegisterToolOptions {
  /** Aborting this signal unregisters the tool. */
  signal?: AbortSignal;
  /** Secure origins allowed to discover and run this tool. */
  exposedTo?: string[];
}

export interface ModelContext extends EventTarget {
  registerTool(tool: ToolDefinition, options?: RegisterToolOptions): Promise<void>;
  getTools(options?: { fromOrigins?: string[] }): Promise<ToolDefinition[]>;
  executeTool(
    tool: ToolDefinition,
    args: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ): Promise<ToolResult>;
}

declare global {
  interface Document {
    modelContext?: ModelContext;
  }
}
