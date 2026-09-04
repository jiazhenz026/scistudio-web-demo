import { MessageSquare } from "lucide-react";

import type { BlockSchemaResponse, LogEntry, WorkflowEdge, WorkflowNode } from "../types/api";
import type { BottomTab } from "../types/ui";

import { useAppStore } from "../store";

import { GitTab } from "./Git/GitTab";
import { LineageTab } from "./Lineage/LineageTab";

import { TerminalTabs } from "./AIChat/TerminalTabs";
import { ConfigPanel } from "./BottomPanel.parts/ConfigPanel";
import { LogViewer } from "./BottomPanel.parts/LogViewer";
import { PlotsTab } from "./BottomPanel.parts/PlotsTab";
import { TabBar } from "./BottomPanel.parts/TabBar";

interface BottomPanelProps {
  activeTab: BottomTab;
  selectedNode: WorkflowNode | null;
  selectedSchema?: BlockSchemaResponse;
  logEntries: LogEntry[];
  onTabChange: (tab: BottomTab) => void;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
  /**
   * ADR-050 FR-014 — ``blockId -> output payload`` map forwarded to the
   * Config tab so it can compute the upstream OME fields used by the
   * selected save node's lossy-save warning detail. OPTIONAL; FE-2's
   * App-level wiring supplies it. When absent the Config tab simply omits
   * the lossy detail (graceful degradation).
   */
  blockOutputs?: Record<string, Record<string, unknown>>;
  /**
   * ADR-050 FR-014 — workflow edges forwarded to the Config tab to resolve
   * which upstream blocks feed the selected node. OPTIONAL for the same
   * reason as ``blockOutputs``.
   */
  edges?: WorkflowEdge[];
  // Unread counter for the Logs tab badge. Defaults to 0; the badge
  // renders only when > 0. (The Problems tab was removed — block errors
  // are already represented by an inline badge on the BlockNode itself
  // and by error-level rows in the Logs panel.)
  unreadLogsCount?: number;
  /**
   * When true, the bottom panel is "pinned" — App.tsx will skip the
   * canvas-pane-click auto-collapse so AI Chat sessions stay open. The
   * pin button in the tab strip toggles this via ``onTogglePin``.
   */
  pinned?: boolean;
  onTogglePin?: () => void;
}

function PlaceholderTab() {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-sm text-stone-400">Coming in Phase 8.5</p>
    </div>
  );
}

// Public WebMCP demo: what the AI Chat tab shows when no scripted tutorial
// replay is running. The demo's live agent is ChatGPT over WebMCP, so this tab
// is not a working in-app chat here — it exists to host the "what-ai-can-do"
// tutorial's scripted session. Rendering a placeholder (rather than the live
// TerminalTabs) means no PTY is spawned until a replay actually needs one.
function AiTabPlaceholder() {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center">
      <div className="max-w-md">
        <MessageSquare className="mx-auto mb-3 size-6 text-stone-400" aria-hidden="true" />
        <p className="text-sm font-medium text-stone-600">AI Chat</p>
        <p className="mt-1 text-sm text-stone-500">
          In this demo your live AI partner is ChatGPT, connected over WebMCP. This
          tab hosts the guided <span className="font-medium">“What AI can do”</span>{" "}
          tutorial — start it from the Learning Center and a scripted SciStudio agent
          session plays out right here.
        </p>
      </div>
    </div>
  );
}

export function BottomPanel({
  activeTab,
  selectedNode,
  selectedSchema,
  logEntries,
  onTabChange,
  onUpdateConfig,
  blockOutputs,
  edges,
  unreadLogsCount = 0,
  pinned = false,
  onTogglePin,
}: BottomPanelProps) {
  // ADR-039 §3.5 — MergeFlow modal is mounted at App.tsx level (NOT
  // here) so it survives BOTH bottom-tab switches AND project close
  // (Codex round-2 P1 on PR #974, follow-up issue #975). BottomPanel
  // itself unmounts when `currentProject` becomes null, which would
  // otherwise bypass MergeFlow's mid-conflict close-guard. See
  // App.tsx for the current mount.

  // Public WebMCP demo: the AI Chat tab hosts the scripted "what-ai-can-do"
  // replay. Mount the live TerminalTabs surface only while such a replay is
  // running (a tab with source "tutorial-replay"); otherwise the tab shows a
  // placeholder and no PTY is spawned.
  const hasScriptedReplay = useAppStore((state) =>
    state.terminalTabs.some((tab) => tab.source === "tutorial-replay"),
  );

  return (
    <section className="flex h-full flex-col overflow-hidden bg-[linear-gradient(180deg,_rgba(255,255,255,0.94),_rgba(238,231,219,0.98))]">
      <TabBar
        activeTab={activeTab}
        onTabChange={onTabChange}
        unreadLogsCount={unreadLogsCount}
        pinned={pinned}
        onTogglePin={onTogglePin}
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2 scrollbar-thin">
        {/* AI Chat surface (public WebMCP demo). Mounted — and only CSS-hidden
            when another tab is active — while a scripted tutorial replay runs,
            so its PTY survives bottom-tab switches (unmount fires the WS cleanup
            hook that kills the child process tree). Outside a replay the tab
            shows a placeholder and nothing is spawned.

            Hotfix #977: the inner white-card frame was removed so the active-tab
            body fills the space without a nested scroll context; the lineage
            (ADR-038 §3.8) and git (ADR-039 §3.5, #972) tabs render inside this
            flat container. */}
        {hasScriptedReplay ? (
          <div className={`h-full ${activeTab === "ai" ? "" : "hidden"}`}>
            <TerminalTabs active={activeTab === "ai"} surface="chat" />
          </div>
        ) : null}
        {activeTab === "ai" ? (
          hasScriptedReplay ? null : <AiTabPlaceholder />
        ) : activeTab === "config" ? (
          // ADR-053 (#2057) — a step saying "set this block's path" points at
          // the panel, not at the node: once a block is selected, the settings
          // are what the reader acts on and the node is only where they came
          // from. Wrapped here rather than inside `ConfigPanel`, which returns
          // from four branches and would need the attribute on each.
          <div className="h-full" data-tutorial-target="config_panel">
            <ConfigPanel
              onUpdateConfig={onUpdateConfig}
              schema={selectedSchema}
              selectedNode={selectedNode}
              blockOutputs={blockOutputs}
              edges={edges}
            />
          </div>
        ) : activeTab === "logs" ? (
          <LogViewer entries={logEntries} />
        ) : activeTab === "plots" ? (
          // #1713 — dedicated Plots panel. Self-contained: reads workflowId /
          // selectedNodeId from the store and publishes Run results to
          // plotPreviewTarget for the Preview panel to render.
          <PlotsTab />
        ) : activeTab === "lineage" ? (
          // ADR-038 §3.8 — D38-2.4b skeleton mounts <LineageTab/>.
          // The root component renders a non-throwing placeholder until
          // D38-2.4c IMPL fills the two-pane runs-list + run-detail view.
          <LineageTab />
        ) : activeTab === "git" ? (
          // ADR-039 §3.5 (#972) — Git tab. GitTab owns its own modal
          // (CommitDialog) so it unmounts when the user switches away
          // from this tab. MergeFlow is mounted separately below (its
          // conflict-state close guard must survive bottom-tab
          // switches; Codex P1 on PR #974).
          <GitTab />
        ) : (
          <PlaceholderTab />
        )}
      </div>
    </section>
  );
}
