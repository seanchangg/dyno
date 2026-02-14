"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useWidgetLayout } from "./useWidgetLayout";
import type { Widget, UIAction, TabbedLayout, DashboardTab } from "@/types/widget";
import { registerBuiltInWidgets } from "@/lib/widgets/built-in";

// Register built-in widget types at module load time (runs once)
registerBuiltInWidgets();

interface WidgetLayoutContextValue {
  layout: TabbedLayout;
  activeTab: DashboardTab;
  widgets: Widget[];
  processUIAction: (action: UIAction) => void;
  setLayout: (layout: TabbedLayout) => void;
  syncTabPositions: (tabId: string, positions: { id: string; x: number; y: number; w: number; h: number }[]) => void;
}

const WidgetLayoutContext = createContext<WidgetLayoutContextValue | null>(null);

export function WidgetLayoutProvider({ children }: { children: ReactNode }) {
  const value = useWidgetLayout();

  return (
    <WidgetLayoutContext.Provider value={value}>
      {children}
    </WidgetLayoutContext.Provider>
  );
}

export function useWidgetLayoutContext() {
  const ctx = useContext(WidgetLayoutContext);
  if (!ctx) {
    throw new Error("useWidgetLayoutContext must be used within a <WidgetLayoutProvider>");
  }
  return ctx;
}
