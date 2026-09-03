// Extracted from BlockNode.tsx as part of the #1422 god-file split.
// FileBrowserModal — lazy-loading filesystem picker used as the fallback
// path-picker when the native OS dialog is unavailable. Opened by
// `InlineTextInputField` via the "..." Browse button for fields whose
// `ui_widget` is "file_browser" or "directory_browser".
//
// file_browser mode is MULTI-select: a Load block's `path` accepts an array,
// and the native OS dialog already returns several files, so the in-app
// fallback must too. Click a file to toggle it, double-click to pick just that
// one. directory_browser stays single-select — a save target is one folder.

import { useCallback, useEffect, useState } from "react";

import { api } from "../../../lib/api";
import type { FilesystemEntry } from "../../../types/api";

type BrowserMode = "file_browser" | "directory_browser";

function formatSize(size: number | null | undefined): string {
  if (size === null || size === undefined) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function navigateBreadcrumb(currentPath: string, index: number): string {
  const parts = currentPath.replace(/\\/g, "/").split("/").filter(Boolean);
  // On Windows paths like "C:/" we need to preserve the drive letter.
  const isWindows = currentPath.includes("\\") || /^[A-Z]:/.test(currentPath);
  if (isWindows) {
    let newPath = parts.slice(0, index + 1).join("\\");
    if (/^[A-Z]:$/.test(newPath)) newPath += "\\";
    return newPath;
  }
  return "/" + parts.slice(0, index + 1).join("/");
}

interface EntryRowProps {
  entry: FilesystemEntry;
  isSelected: boolean;
  mode: BrowserMode;
  currentPath: string;
  onToggleSelect: (name: string) => void;
  onNavigate: (dirName: string) => void;
  onConfirmFile: (path: string) => void;
}

function EntryRow({
  entry,
  isSelected,
  mode,
  currentPath,
  onToggleSelect,
  onNavigate,
  onConfirmFile,
}: EntryRowProps) {
  const isDir = entry.type === "directory";
  // What this row can contribute to the selection: a directory in directory
  // mode, a file in file mode. The other kind is shown (for navigation /
  // context) but not selectable.
  const isSelectable = isDir ? mode === "directory_browser" : mode === "file_browser";
  const sep = currentPath.includes("\\") ? "\\" : "/";
  return (
    <div
      className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs ${
        isSelected ? "bg-blue-50 text-sea" : "text-ink hover:bg-stone-50"
      } ${!isSelectable ? "opacity-50" : ""}`}
      onClick={() => {
        if (isSelectable) onToggleSelect(entry.name);
      }}
      onDoubleClick={() => {
        if (isDir) {
          onNavigate(entry.name);
        } else if (mode === "file_browser") {
          onConfirmFile(`${currentPath}${sep}${entry.name}`);
        }
      }}
    >
      {/* Multi-select affordance: a checkbox for selectable files so it reads as
          "tick several", not "pick one". Directories and the single-select
          directory mode keep the plain icon. */}
      {mode === "file_browser" && !isDir ? (
        <span
          aria-hidden
          className={`flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border text-[9px] leading-none ${
            isSelected ? "border-sea bg-sea text-white" : "border-stone-300 text-transparent"
          }`}
        >
          ✓
        </span>
      ) : null}
      <span className="shrink-0 text-sm">{isDir ? "📁" : "📄"}</span>
      <span className="min-w-0 flex-1 truncate">{entry.name}</span>
      {!isDir && entry.size !== null && entry.size !== undefined && (
        <span className="shrink-0 text-stone-400">{formatSize(entry.size)}</span>
      )}
    </div>
  );
}

interface EntryListProps {
  loading: boolean;
  error: string | null;
  entries: FilesystemEntry[];
  selected: string[];
  mode: BrowserMode;
  currentPath: string;
  onToggleSelect: (name: string) => void;
  onNavigate: (dirName: string) => void;
  onConfirmFile: (path: string) => void;
}

function EntryList(props: EntryListProps) {
  const {
    loading,
    error,
    entries,
    selected,
    mode,
    currentPath,
    onToggleSelect,
    onNavigate,
    onConfirmFile,
  } = props;
  if (loading) return <p className="py-4 text-center text-xs text-stone-400">Loading...</p>;
  if (error) return <p className="py-4 text-center text-xs text-red-500">{error}</p>;
  if (entries.length === 0) {
    return <p className="py-4 text-center text-xs text-stone-400">Empty directory</p>;
  }
  return (
    <>
      {entries.map((entry) => (
        <EntryRow
          key={entry.name}
          entry={entry}
          isSelected={selected.includes(entry.name)}
          mode={mode}
          currentPath={currentPath}
          onToggleSelect={onToggleSelect}
          onNavigate={onNavigate}
          onConfirmFile={onConfirmFile}
        />
      ))}
    </>
  );
}

interface BreadcrumbsProps {
  currentPath: string;
  onClick: (index: number) => void;
}

function Breadcrumbs({ currentPath, onClick }: BreadcrumbsProps) {
  const parts = currentPath ? currentPath.replace(/\\/g, "/").split("/").filter(Boolean) : [];
  // Build per-row keys from the cumulative path prefix so duplicate segment
  // names (e.g. nested ``foo/foo``) still yield stable, non-index-based keys.
  const breadcrumbs = parts.map((part, i) => ({
    part,
    index: i,
    key: parts.slice(0, i + 1).join("/"),
  }));
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-stone-500">
      <button type="button" className="hover:text-sea" onClick={() => onClick(-1)}>
        Root
      </button>
      {breadcrumbs.map(({ part, index, key }) => (
        <span key={key} className="flex items-center gap-1">
          <span>/</span>
          <button type="button" className="hover:text-sea" onClick={() => onClick(index)}>
            {part}
          </button>
        </span>
      ))}
    </div>
  );
}

export function FileBrowserModal({
  mode,
  initialPath,
  onSelect,
  onCancel,
}: {
  mode: BrowserMode;
  initialPath: string;
  // Always an array. file_browser may return several paths; directory_browser
  // returns exactly one. The caller (ConfigField.applySelectedPath) collapses a
  // single-element array to a scalar for non-array fields.
  onSelect: (paths: string[]) => void;
  onCancel: () => void;
}) {
  const [currentPath, setCurrentPath] = useState("");
  const [entries, setEntries] = useState<FilesystemEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Selected entry names within the CURRENT directory. file_browser accumulates
  // several; directory_browser holds at most one.
  const [selected, setSelected] = useState<string[]>([]);

  const loadDirectory = useCallback(async (dirPath: string) => {
    setLoading(true);
    setError(null);
    // Selection is scoped to a directory; changing directory clears it.
    setSelected([]);
    try {
      const resp = await api.browseFilesystem(dirPath);
      setCurrentPath(resp.path);
      setEntries(resp.entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to browse");
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Try to start from the current value's directory
    loadDirectory(initialPath || "");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleNavigate = (dirName: string) => {
    const sep = currentPath.includes("\\") ? "\\" : "/";
    const newPath = currentPath ? `${currentPath}${sep}${dirName}` : dirName;
    loadDirectory(newPath);
  };

  const handleBreadcrumbClick = (index: number) => {
    if (index < 0) {
      loadDirectory("");
      return;
    }
    loadDirectory(navigateBreadcrumb(currentPath, index));
  };

  const handleToggleSelect = (name: string) =>
    setSelected((prev) => {
      if (prev.includes(name)) return prev.filter((n) => n !== name);
      // directory mode is single-select: a save target is one folder.
      if (mode === "directory_browser") return [name];
      return [...prev, name];
    });

  const join = (name: string) => {
    const sep = currentPath.includes("\\") ? "\\" : "/";
    return `${currentPath}${sep}${name}`;
  };

  const handleSelect = () => {
    if (mode === "directory_browser") {
      onSelect([selected.length > 0 ? join(selected[0]) : currentPath]);
      return;
    }
    if (selected.length > 0) {
      onSelect(selected.map(join));
    }
  };

  const canSelect =
    mode === "directory_browser"
      ? currentPath !== "" || selected.length > 0
      : selected.length > 0;

  const selectLabel =
    mode === "directory_browser"
      ? selected.length > 0
        ? "Select folder"
        : "Select this folder"
      : selected.length > 1
        ? `Select ${selected.length} files`
        : "Select file";

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40"
      onClick={onCancel}
    >
      <div
        className="flex max-h-[70vh] w-[500px] flex-col rounded-xl border border-stone-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="border-b border-stone-100 px-4 py-3">
          <div className="text-sm font-semibold text-ink">
            {mode === "file_browser" ? "Select Files" : "Select Directory"}
          </div>
          <Breadcrumbs currentPath={currentPath} onClick={handleBreadcrumbClick} />
        </div>

        {/* File list */}
        <div className="min-h-[200px] flex-1 overflow-y-auto px-2 py-1">
          <EntryList
            loading={loading}
            error={error}
            entries={entries}
            selected={selected}
            mode={mode}
            currentPath={currentPath}
            onToggleSelect={handleToggleSelect}
            onNavigate={handleNavigate}
            onConfirmFile={(path) => onSelect([path])}
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t border-stone-100 px-4 py-2">
          <span className="text-[11px] text-stone-400">
            {mode === "file_browser"
              ? selected.length > 0
                ? `${selected.length} selected`
                : "Click to select, double-click to open a folder"
              : ""}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded border border-stone-200 px-3 py-1.5 text-xs text-stone-600 hover:bg-stone-50"
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rounded bg-blue-500 px-3 py-1.5 text-xs text-white hover:bg-blue-600 disabled:opacity-40"
              disabled={!canSelect}
              onClick={handleSelect}
            >
              {selectLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
