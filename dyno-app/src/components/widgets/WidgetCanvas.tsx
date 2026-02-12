"use client";

import React, { Suspense, useRef, useEffect, useState, useCallback, useMemo } from "react";
import { GridLayout, verticalCompactor } from "react-grid-layout";
import type { Layout, LayoutItem } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import type { Widget } from "@/types/widget";
import { getWidget } from "@/lib/widgets/registry";

interface WidgetCanvasProps {
  widgets: Widget[];
  onLayoutChange: (widgets: Widget[]) => void;
  onRemoveWidget: (widgetId: string) => void;
}

export default function WidgetCanvas({
  widgets,
  onLayoutChange,
  onRemoveWidget,
}: WidgetCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1200);

  // Observe container width for responsive sizing
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWidth(entry.contentRect.width);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Convert Widget[] to Layout (readonly LayoutItem[])
  const layout: Layout = useMemo(() => {
    return widgets.map((w): LayoutItem => {
      const reg = getWidget(w.type);
      return {
        i: w.id,
        x: w.x,
        y: w.y,
        w: w.w,
        h: w.h,
        minW: reg?.minW,
        minH: reg?.minH,
        maxW: reg?.maxW,
        maxH: reg?.maxH,
      };
    });
  }, [widgets]);

  // Debounced layout change handler
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const widgetsRef = useRef(widgets);
  widgetsRef.current = widgets;

  const handleLayoutChange = useCallback(
    (newLayout: Layout) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const current = widgetsRef.current;
        const updated = current.map((w) => {
          const l = newLayout.find((n) => n.i === w.id);
          if (!l) return w;
          return { ...w, x: l.x, y: l.y, w: l.w, h: l.h };
        });
        onLayoutChange(updated);
      }, 300);
    },
    [onLayoutChange]
  );

  return (
    <div ref={containerRef} className="w-full">
      {width > 0 && (
        <GridLayout
          className="widget-grid-layout"
          layout={layout}
          width={width}
          gridConfig={{
            cols: 12,
            rowHeight: 60,
            margin: [16, 16] as [number, number],
            containerPadding: [0, 0] as [number, number],
            maxRows: Infinity,
          }}
          dragConfig={{
            enabled: true,
            bounded: false,
            handle: ".widget-drag-handle",
            threshold: 3,
          }}
          compactor={verticalCompactor}
          onLayoutChange={handleLayoutChange}
        >
          {widgets.map((widget) => (
            <div key={widget.id} className="widget-container">
              <WidgetWrapper
                widget={widget}
                onRemove={() => onRemoveWidget(widget.id)}
              />
            </div>
          ))}
        </GridLayout>
      )}
    </div>
  );
}

interface WidgetWrapperProps {
  widget: Widget;
  onRemove: () => void;
}

function WidgetWrapper({ widget, onRemove }: WidgetWrapperProps) {
  const reg = getWidget(widget.type);

  if (!reg) {
    return (
      <div className="h-full bg-surface border border-primary/20 flex items-center justify-center">
        <span className="text-xs text-text/30">Unknown widget: {widget.type}</span>
      </div>
    );
  }

  const Component = reg.component;
  const props = { ...widget.props, sessionId: widget.sessionId };

  return (
    <div className="h-full flex flex-col">
      {/* Drag handle bar */}
      <div className="widget-drag-handle flex items-center justify-between px-2 py-1 bg-primary/10 cursor-move select-none shrink-0">
        <span className="text-[10px] text-text/30 font-mono truncate">
          {widget.id}
        </span>
        {widget.id !== "master-chat" && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="text-[10px] text-text/20 hover:text-danger/60 transition-colors cursor-pointer ml-2"
            onMouseDown={(e) => e.stopPropagation()}
          >
            close
          </button>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <Suspense
          fallback={
            <div className="h-full flex items-center justify-center bg-surface">
              <span className="text-xs text-text/30">Loading...</span>
            </div>
          }
        >
          <Component {...props} />
        </Suspense>
      </div>
    </div>
  );
}
