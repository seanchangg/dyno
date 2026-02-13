"use client";

import { useCallback, useMemo, useState, useRef, useEffect } from "react";
import { usePathname } from "next/navigation";
import WidgetCanvas from "@/components/widgets/WidgetCanvas";
import TabBar from "@/components/widgets/TabBar";
import { useWidgetLayoutContext } from "@/hooks/useWidgetLayoutContext";
import { useSession } from "@/hooks/useSessionManager";
import { getAllWidgetTypes } from "@/lib/widgets/registry";
import type { Widget } from "@/types/widget";

/**
 * Always-mounted dashboard canvas. Hidden (display:none) when on a
 * non-dashboard route so widgets (music, iframes, etc.) stay alive.
 */
export default function PersistentDashboard() {
  const pathname = usePathname();
  const isDashboard = pathname === "/dashboard";

  const { layout, setLayout, processUIAction } = useWidgetLayoutContext();
  const { cancelSession } = useSession("master");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [mountedTabs, setMountedTabs] = useState<Set<string>>(() => new Set([layout.activeTabId]));

  useEffect(() => {
    setMountedTabs((prev) => {
      if (prev.has(layout.activeTabId)) return prev;
      const next = new Set(prev);
      next.add(layout.activeTabId);
      return next;
    });
  }, [layout.activeTabId]);

  useEffect(() => {
    const tabIds = new Set(layout.tabs.map((t) => t.id));
    setMountedTabs((prev) => {
      const next = new Set<string>();
      for (const id of prev) {
        if (tabIds.has(id)) next.add(id);
      }
      return next;
    });
  }, [layout.tabs]);

  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const handleTabLayoutChange = useCallback(
    (tabId: string, updated: Widget[]) => {
      const current = layoutRef.current;
      setLayout({
        ...current,
        tabs: current.tabs.map((t) =>
          t.id === tabId ? { ...t, widgets: updated } : t
        ),
      });
    },
    [setLayout]
  );

  const tabCallbacksRef = useRef(new Map<string, (updated: Widget[]) => void>());
  const getTabCallback = useCallback(
    (tabId: string) => {
      let cb = tabCallbacksRef.current.get(tabId);
      if (!cb) {
        cb = (updated: Widget[]) => handleTabLayoutChange(tabId, updated);
        tabCallbacksRef.current.set(tabId, cb);
      }
      return cb;
    },
    [handleTabLayoutChange]
  );

  const handleRemoveWidget = useCallback(
    (widgetId: string) => {
      if (widgetId.startsWith("chat-child-")) {
        const sessionId = widgetId.replace("chat-", "");
        cancelSession(sessionId);
        // Clear persisted child session data
        try { localStorage.removeItem(`marty-child-${sessionId}`); } catch { /* ignore */ }
      }
      processUIAction({ action: "remove", widgetId });
    },
    [processUIAction, cancelSession]
  );

  const handleAddWidget = useCallback(
    (widgetType: string) => {
      const id = `${widgetType}-${Date.now()}`;
      processUIAction({ action: "add", widgetId: id, widgetType });
      setMenuOpen(false);
    },
    [processUIAction]
  );

  const handleTabSwitch = useCallback(
    (tabId: string) => processUIAction({ action: "tab_switch", widgetId: "", tabId }),
    [processUIAction]
  );
  const handleTabCreate = useCallback(
    () => processUIAction({ action: "tab_create", widgetId: "" }),
    [processUIAction]
  );
  const handleTabDelete = useCallback(
    (tabId: string) => processUIAction({ action: "tab_delete", widgetId: "", tabId }),
    [processUIAction]
  );
  const handleTabRename = useCallback(
    (tabId: string, label: string) => processUIAction({ action: "tab_rename", widgetId: "", tabId, tabLabel: label }),
    [processUIAction]
  );
  const handleTabReorder = useCallback(
    (tabId: string, newIndex: number) => processUIAction({ action: "tab_reorder", widgetId: "", tabId, tabIndex: newIndex }),
    [processUIAction]
  );

  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  const widgetTypes = getAllWidgetTypes();

  const nonCloseableTabIds = useMemo(() => {
    const ids = new Set<string>();
    for (const tab of layout.tabs) {
      if (tab.label === "Main") ids.add(tab.id);
    }
    return ids;
  }, [layout.tabs]);

  return (
    <div
      style={{ display: isDashboard ? "flex" : "none" }}
      className="min-h-[calc(100vh-4rem)] flex-col absolute inset-0"
    >
      <TabBar
        tabs={layout.tabs}
        activeTabId={layout.activeTabId}
        nonCloseableTabIds={nonCloseableTabIds}
        onSwitch={handleTabSwitch}
        onCreate={handleTabCreate}
        onDelete={handleTabDelete}
        onRename={handleTabRename}
        onReorder={handleTabReorder}
      />

      <div className="flex-1 relative">
        {layout.tabs.map((tab) => {
          if (!mountedTabs.has(tab.id)) return null;
          const isActive = tab.id === layout.activeTabId;
          return (
            <div
              key={tab.id}
              style={{ display: isActive ? "block" : "none" }}
              className="absolute inset-0"
            >
              <WidgetCanvas
                widgets={tab.widgets}
                onLayoutChange={getTabCallback(tab.id)}
                onRemoveWidget={handleRemoveWidget}
              />
            </div>
          );
        })}
      </div>

      {/* Add Widget Button */}
      <div ref={menuRef} className="fixed bottom-6 right-6 z-40">
        {menuOpen && (
          <div className="absolute bottom-14 right-0 w-52 bg-surface border border-primary/30 shadow-lg py-1 mb-2">
            <div className="px-3 py-1.5 text-[10px] text-text/30 uppercase tracking-wider">
              Add Widget
            </div>
            {widgetTypes.map((reg) => (
              <button
                key={reg.type}
                onClick={() => handleAddWidget(reg.type)}
                className="w-full text-left px-3 py-2 text-sm text-text/70 hover:bg-primary/20 hover:text-highlight transition-colors cursor-pointer"
              >
                {reg.label}
              </button>
            ))}
          </div>
        )}
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="w-10 h-10 bg-primary text-highlight border border-primary/40 hover:bg-secondary transition-colors cursor-pointer flex items-center justify-center text-xl font-light"
        >
          {menuOpen ? "\u00D7" : "+"}
        </button>
      </div>
    </div>
  );
}
