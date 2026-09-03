/**
 * Registers SciStudio's MCP tools with the browser agent via WebMCP.
 *
 * The catalogue is the backend's, not a second hand-written list: the page
 * fetches `/api/webmcp/tools`, which is the same FastMCP instance the local
 * socket transport serves. A tool added to the Python server appears here
 * without a frontend change, and the two surfaces cannot drift.
 *
 * Each `execute` posts back to `/api/webmcp/call`, so a tool invoked by ChatGPT
 * runs exactly the code path a local agent's tool call runs. The visible
 * consequence is that the SciStudio UI updates as the agent works — the user
 * watches the graph change rather than reading a transcript about it.
 */

import { apiFetch } from "../lib/api/core";
import { logger } from "../lib/logger";

import { setWebmcpStatus } from "./badge";

import type { ModelContext, ToolResult } from "./types";

interface CatalogueEntry {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  category: string;
  mutation: "read" | "write";
}

/** Tools registered so far, so a re-registration can replace rather than duplicate. */
let activeRegistration: AbortController | null = null;

/**
 * Locate the WebMCP entry point.
 *
 * The API moved during the origin trial: Chrome 149 shipped it as
 * `navigator.modelContext`, Chrome 150 moved it to `document.modelContext`.
 * Both versions are in the trial simultaneously, so probing both is the
 * difference between working on a judge's browser and not.
 */
function findModelContext(): { context: ModelContext; where: string } | null {
  if (document.modelContext) return { context: document.modelContext, where: "document" };
  if (navigator.modelContext) return { context: navigator.modelContext, where: "navigator" };
  return null;
}

async function fetchCatalogue(): Promise<CatalogueEntry[]> {
  const response = await apiFetch<{ tools: CatalogueEntry[] }>("/api/webmcp/tools");
  return response.tools;
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ToolResult> {
  return apiFetch<ToolResult>("/api/webmcp/call", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, arguments: args }),
    signal,
  });
}

/**
 * Register every backend tool with `document.modelContext`.
 *
 * Safe to call when WebMCP is unavailable: the function reports why and
 * returns 0, because a browser without the origin trial is the ordinary case,
 * not a failure. Calling it again unregisters the previous set first, so a
 * project switch re-registers cleanly instead of accumulating duplicates.
 */
export async function registerSciStudioTools(): Promise<number> {
  setWebmcpStatus("pending", "WebMCP · checking…");

  const found = findModelContext();
  if (!found) {
    const chrome = navigator.userAgent.match(/Chrome\/(\d+)/)?.[1] ?? "unknown";
    const why =
      `Neither document.modelContext nor navigator.modelContext is defined. ` +
      `Chrome ${chrome}. The API needs Chrome 149+ with ` +
      `chrome://flags/#enable-webmcp-testing enabled and the browser fully relaunched, ` +
      `or a browser that ships WebMCP (ChatGPT desktop).`;
    // warn, not info: below the logger's reflux threshold nothing reaches the
    // backend, and this is the one message worth having in the server log when
    // the page runs somewhere with no DevTools.
    logger.warn(`WebMCP unavailable — ${why}`);
    setWebmcpStatus("unavailable", "WebMCP unavailable", why);
    return 0;
  }
  const { context: modelContext, where } = found;

  activeRegistration?.abort();
  const controller = new AbortController();
  activeRegistration = controller;

  let catalogue: CatalogueEntry[];
  try {
    catalogue = await fetchCatalogue();
  } catch (error) {
    logger.error("WebMCP: could not fetch the tool catalogue", { error: String(error) });
    setWebmcpStatus("error", "WebMCP · catalogue failed", String(error));
    return 0;
  }

  let registered = 0;
  for (const entry of catalogue) {
    try {
      await modelContext.registerTool(
        {
          name: entry.name,
          description: entry.description,
          inputSchema: entry.inputSchema,
          execute: async (args, options) => {
            logger.debug(`WebMCP → ${entry.name}`);
            try {
              return await callTool(entry.name, args ?? {}, options?.signal);
            } catch (error) {
              // Handed back as tool content rather than thrown: a failed call
              // is something the agent can act on, and an exception would
              // reach it as an opaque dead end.
              return {
                content: [{ type: "text", text: `Tool call failed: ${String(error)}` }],
                isError: true,
              };
            }
          },
        },
        { signal: controller.signal },
      );
      registered += 1;
    } catch (error) {
      logger.warn(`WebMCP: refused to register '${entry.name}'`, { error: String(error) });
    }
  }

  const summary = `registered ${registered}/${catalogue.length} tools via ${where}.modelContext`;
  logger.warn(`WebMCP: ${summary}`);
  setWebmcpStatus(
    registered === catalogue.length ? "ok" : "error",
    `WebMCP · ${registered} tools`,
    summary,
  );
  return registered;
}
