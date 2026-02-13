"use client";

import { useReducer, useEffect, useCallback, useRef } from "react";
import type { Widget, UIAction, TabbedLayout, DashboardTab } from "@/types/widget";
import { getWidget } from "@/lib/widgets/registry";
import { DEFAULT_WIDGETS } from "@/lib/widgets/default-layout";
import { migrateLayout, createDefaultTabbedLayout } from "@/lib/widgets/migration";
import { useAuth } from "@/hooks/useAuth";
import { fetchLayout, saveLayoutToSupabase } from "@/lib/supabase/layout";
import { authFetch } from "@/lib/api";

// Widget IDs that cannot be removed — losing these locks the user out of core functionality
export const PROTECTED_WIDGET_IDS = new Set(["master-chat"]);

// ── Widget-level reducer (operates on a single tab's widgets) ───────────────

function widgetReducer(state: Widget[], action: UIAction): Widget[] {
  switch (action.action) {
    case "add": {
      if (state.find((w) => w.id === action.widgetId)) {
        console.log("[layout] Duplicate widget, skipping:", action.widgetId);
        return state;
      }
      const reg = action.widgetType ? getWidget(action.widgetType) : undefined;
      const newWidget: Widget = {
        id: action.widgetId,
        type: action.widgetType || "markdown",
        x: action.position?.x ?? 0,
        y: action.position?.y ?? findBottomY(state),
        w: action.size?.w ?? reg?.defaultW ?? 4,
        h: action.size?.h ?? reg?.defaultH ?? 4,
        props: action.props,
        sessionId: action.sessionId,
      };
      console.log("[layout] Adding widget:", newWidget.id, newWidget.type, `${newWidget.w}x${newWidget.h} at (${newWidget.x},${newWidget.y})`);
      return [...state, newWidget];
    }

    case "remove":
      if (PROTECTED_WIDGET_IDS.has(action.widgetId)) return state;
      return state.filter((w) => w.id !== action.widgetId);

    case "update":
      return state.map((w) =>
        w.id === action.widgetId
          ? { ...w, props: { ...w.props, ...action.props } }
          : w
      );

    case "move":
      return state.map((w) =>
        w.id === action.widgetId && action.position
          ? { ...w, x: action.position.x, y: action.position.y }
          : w
      );

    case "resize":
      return state.map((w) =>
        w.id === action.widgetId && action.size
          ? { ...w, w: action.size.w, h: action.size.h }
          : w
      );

    case "clear":
      return state.filter((w) => PROTECTED_WIDGET_IDS.has(w.id));

    case "reset":
      return [...DEFAULT_WIDGETS];

    default:
      return state;
  }
}

function findBottomY(widgets: Widget[]): number {
  if (widgets.length === 0) return 0;
  return Math.max(...widgets.map((w) => w.y + w.h));
}

// ── Tab-level reducer (operates on the full TabbedLayout) ───────────────────

type LayoutAction =
  | { type: "set"; layout: TabbedLayout }
  | { type: "ui_action"; action: UIAction };

function generateTabId(): string {
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function layoutReducer(state: TabbedLayout, action: LayoutAction): TabbedLayout {
  switch (action.type) {
    case "set":
      return action.layout;

    case "ui_action": {
      const a = action.action;

      switch (a.action) {
        case "tab_create": {
          const newTabId = a.tabId || generateTabId();
          const newTab: DashboardTab = {
            id: newTabId,
            label: a.tabLabel || "New Tab",
            widgets: [],
          };
          return {
            ...state,
            activeTabId: newTabId,
            tabs: [...state.tabs, newTab],
          };
        }

        case "tab_delete": {
          const targetId = a.tabId || state.activeTabId;
          if (state.tabs.length <= 1) return state; // min 1 tab
          // Block deletion of the Main tab
          const targetTab = state.tabs.find((t) => t.id === targetId);
          if (targetTab?.label === "Main") return state;
          const remaining = state.tabs.filter((t) => t.id !== targetId);
          const newActive =
            state.activeTabId === targetId
              ? remaining[0].id
              : state.activeTabId;
          return {
            ...state,
            activeTabId: newActive,
            tabs: remaining,
          };
        }

        case "tab_rename": {
          const targetId = a.tabId || state.activeTabId;
          if (!a.tabLabel) return state;
          return {
            ...state,
            tabs: state.tabs.map((t) =>
              t.id === targetId ? { ...t, label: a.tabLabel! } : t
            ),
          };
        }

        case "tab_reorder": {
          if (a.tabIndex == null) return state;
          const targetId = a.tabId || state.activeTabId;
          const currentIndex = state.tabs.findIndex((t) => t.id === targetId);
          if (currentIndex === -1) return state;
          const newTabs = [...state.tabs];
          const [moved] = newTabs.splice(currentIndex, 1);
          const clampedIndex = Math.max(0, Math.min(a.tabIndex, newTabs.length));
          newTabs.splice(clampedIndex, 0, moved);
          return { ...state, tabs: newTabs };
        }

        case "tab_switch": {
          const targetId = a.tabId;
          if (!targetId || !state.tabs.some((t) => t.id === targetId)) return state;
          return { ...state, activeTabId: targetId };
        }

        case "move_to_tab": {
          const targetTabId = a.tabId;
          if (!targetTabId || !a.widgetId) return state;
          const sourceTab = state.tabs.find((t) =>
            t.widgets.some((w) => w.id === a.widgetId)
          );
          if (!sourceTab) return state;
          if (sourceTab.id === targetTabId) return state;
          const widget = sourceTab.widgets.find((w) => w.id === a.widgetId);
          if (!widget) return state;
          return {
            ...state,
            tabs: state.tabs.map((t) => {
              if (t.id === sourceTab.id) {
                return { ...t, widgets: t.widgets.filter((w) => w.id !== a.widgetId) };
              }
              if (t.id === targetTabId) {
                return { ...t, widgets: [...t.widgets, widget] };
              }
              return t;
            }),
          };
        }

        default: {
          // Widget-level actions — delegate to widgetReducer scoped to target tab
          const targetTabId = a.tabId || state.activeTabId;
          return {
            ...state,
            tabs: state.tabs.map((t) => {
              if (t.id !== targetTabId) return t;
              const updatedWidgets = widgetReducer(t.widgets, a);
              if (updatedWidgets === t.widgets) return t;
              return { ...t, widgets: updatedWidgets };
            }),
          };
        }
      }
    }

    default:
      return state;
  }
}

// ── Hook ────────────────────────────────────────────────────────────────────

export function useWidgetLayout() {
  const [layout, dispatch] = useReducer(layoutReducer, null, createDefaultTabbedLayout);
  const { user } = useAuth();
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialLoadDone = useRef(false);

  // Load layout on mount: try Supabase first, then local file, then defaults
  useEffect(() => {
    async function load() {
      if (initialLoadDone.current) return;
      initialLoadDone.current = true;

      // Try Supabase
      if (user?.id) {
        try {
          const saved = await fetchLayout(user.id);
          if (saved && saved.tabs.length > 0) {
            dispatch({ type: "set", layout: saved });
            return;
          }
        } catch {
          // Fall through to local
        }
      }

      // Try local file
      try {
        const res = await authFetch("/api/layout");
        if (res.ok) {
          const data = await res.json();
          const migrated = migrateLayout(data);
          if (migrated.tabs.length > 0 && migrated.tabs.some((t) => t.widgets.length > 0)) {
            dispatch({ type: "set", layout: migrated });
            return;
          }
        }
      } catch {
        // Fall through to defaults
      }

      // Use defaults (already set as initial state)
    }
    load();
  }, [user]);

  // Debounced save whenever layout changes
  useEffect(() => {
    if (!initialLoadDone.current) return;

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      // Save to local file
      authFetch("/api/layout", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(layout),
      }).catch(() => {});

      // Save to Supabase
      if (user?.id) {
        saveLayoutToSupabase(user.id, layout).catch(() => {});
      }
    }, 1000);

    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [layout, user]);

  const processUIAction = useCallback((action: UIAction) => {
    dispatch({ type: "ui_action", action });
  }, []);

  const setLayout = useCallback((newLayout: TabbedLayout) => {
    dispatch({ type: "set", layout: newLayout });
  }, []);

  const activeTab = layout.tabs.find((t) => t.id === layout.activeTabId) || layout.tabs[0];
  const widgets = activeTab?.widgets ?? [];

  return {
    layout,
    activeTab,
    widgets,
    processUIAction,
    setLayout,
  };
}
