"use client";

import { useReducer, useEffect, useCallback, useRef } from "react";
import type { Widget, UIAction } from "@/types/widget";
import { getWidget } from "@/lib/widgets/registry";
import { DEFAULT_WIDGETS } from "@/lib/widgets/default-layout";
import { useAuth } from "@/hooks/useAuth";
import { fetchLayout, saveLayoutToSupabase } from "@/lib/supabase/layout";

type LayoutAction =
  | { type: "set"; widgets: Widget[] }
  | { type: "ui_action"; action: UIAction };

function layoutReducer(state: Widget[], action: LayoutAction): Widget[] {
  switch (action.type) {
    case "set":
      return action.widgets;

    case "ui_action": {
      const a = action.action;
      switch (a.action) {
        case "add": {
          // Don't add duplicates
          if (state.find((w) => w.id === a.widgetId)) {
            console.log("[layout] Duplicate widget, skipping:", a.widgetId);
            return state;
          }
          const reg = a.widgetType ? getWidget(a.widgetType) : undefined;
          const newWidget: Widget = {
            id: a.widgetId,
            type: a.widgetType || "markdown",
            x: a.position?.x ?? 0,
            y: a.position?.y ?? findBottomY(state),
            w: a.size?.w ?? reg?.defaultW ?? 4,
            h: a.size?.h ?? reg?.defaultH ?? 4,
            props: a.props,
            sessionId: a.sessionId,
          };
          console.log("[layout] Adding widget:", newWidget.id, newWidget.type, `${newWidget.w}x${newWidget.h} at (${newWidget.x},${newWidget.y})`);
          return [...state, newWidget];
        }

        case "remove":
          return state.filter((w) => w.id !== a.widgetId);

        case "update":
          return state.map((w) =>
            w.id === a.widgetId
              ? { ...w, props: { ...w.props, ...a.props } }
              : w
          );

        case "move":
          return state.map((w) =>
            w.id === a.widgetId && a.position
              ? { ...w, x: a.position.x, y: a.position.y }
              : w
          );

        case "resize":
          return state.map((w) =>
            w.id === a.widgetId && a.size
              ? { ...w, w: a.size.w, h: a.size.h }
              : w
          );

        case "clear":
          return [];

        case "reset":
          return [...DEFAULT_WIDGETS];

        default:
          return state;
      }
    }

    default:
      return state;
  }
}

function findBottomY(widgets: Widget[]): number {
  if (widgets.length === 0) return 0;
  return Math.max(...widgets.map((w) => w.y + w.h));
}

export function useWidgetLayout() {
  const [widgets, dispatch] = useReducer(layoutReducer, DEFAULT_WIDGETS);
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
          const layout = await fetchLayout(user.id);
          if (layout && layout.length > 0) {
            dispatch({ type: "set", widgets: layout });
            return;
          }
        } catch {
          // Fall through to local
        }
      }

      // Try local file
      try {
        const res = await fetch("/api/layout");
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.widgets) && data.widgets.length > 0) {
            dispatch({ type: "set", widgets: data.widgets });
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

  // Debounced save whenever widgets change
  useEffect(() => {
    if (!initialLoadDone.current) return;

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      // Save to local file
      fetch("/api/layout", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ widgets }),
      }).catch(() => {});

      // Save to Supabase
      if (user?.id) {
        saveLayoutToSupabase(user.id, widgets).catch(() => {});
      }
    }, 1000);

    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [widgets, user]);

  const processUIAction = useCallback((action: UIAction) => {
    dispatch({ type: "ui_action", action });
  }, []);

  const setWidgets = useCallback((newWidgets: Widget[]) => {
    dispatch({ type: "set", widgets: newWidgets });
  }, []);

  return {
    widgets,
    processUIAction,
    setWidgets,
  };
}
