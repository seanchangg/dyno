"use client";

import { useCallback, useState, useRef, useEffect } from "react";
import WidgetCanvas from "@/components/widgets/WidgetCanvas";
import { useWidgetLayoutContext } from "@/hooks/useWidgetLayoutContext";
import { useSession } from "@/hooks/useSessionManager";
import { getAllWidgetTypes } from "@/lib/widgets/registry";
import type { Widget } from "@/types/widget";

export default function DashboardPage() {
  const { widgets, setWidgets, processUIAction } = useWidgetLayoutContext();
  const { cancelSession } = useSession("master");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleLayoutChange = useCallback(
    (updated: Widget[]) => {
      setWidgets(updated);
    },
    [setWidgets]
  );

  const handleRemoveWidget = useCallback(
    (widgetId: string) => {
      if (widgetId.startsWith("chat-child-")) {
        const sessionId = widgetId.replace("chat-", "");
        cancelSession(sessionId);
      }
      processUIAction({ action: "remove", widgetId });
    },
    [processUIAction, cancelSession]
  );

  const handleAddWidget = useCallback(
    (widgetType: string) => {
      const id = `${widgetType}-${Date.now()}`;
      processUIAction({
        action: "add",
        widgetId: id,
        widgetType,
      });
      setMenuOpen(false);
    },
    [processUIAction]
  );

  // Close menu on outside click
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

  return (
    <div className="min-h-[calc(100vh-4rem)]">
      <WidgetCanvas
        widgets={widgets}
        onLayoutChange={handleLayoutChange}
        onRemoveWidget={handleRemoveWidget}
      />

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
