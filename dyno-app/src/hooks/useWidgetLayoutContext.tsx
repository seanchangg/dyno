"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useWidgetLayout } from "./useWidgetLayout";
import type { Widget, UIAction } from "@/types/widget";
import { registerBuiltInWidgets } from "@/lib/widgets/built-in";

// Register built-in widget types at module load time (runs once)
registerBuiltInWidgets();

interface WidgetLayoutContextValue {
  widgets: Widget[];
  processUIAction: (action: UIAction) => void;
  setWidgets: (widgets: Widget[]) => void;
}

const WidgetLayoutContext = createContext<WidgetLayoutContextValue | null>(null);

export function WidgetLayoutProvider({ children }: { children: ReactNode }) {
  const layout = useWidgetLayout();

  return (
    <WidgetLayoutContext.Provider value={layout}>
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
