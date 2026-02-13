"use client";

import React, { Suspense, useRef, useEffect, useState, useCallback, useMemo } from "react";
import { GridLayout } from "react-grid-layout";
import type { Layout, LayoutItem } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import type { Widget } from "@/types/widget";
import { getWidget } from "@/lib/widgets/registry";

// ── Base grid constants (never change — zoom scales visually) ────────────────

const GRID_COLS = 48;
const ROW_HEIGHT = 60;
const GAP = 16;
const GRID_WIDTH = 7200;
const BASE_SNAP_X = GRID_WIDTH / GRID_COLS; // 150px per column
const BASE_SNAP_Y = ROW_HEIGHT + GAP;       // 76px per row
const DEFAULT_ORIGIN_COL = 1;
const SNAP_DELAY = 60;
const ZOOM_STEP = 0.12;
const MIN_ZOOM = -5;
const MAX_ZOOM = 5;

const STORAGE_KEY = "dyno-canvas-viewport";
const SAVE_DELAY = 500;

function loadViewport(): { zoom: number; scrollX: number; scrollY: number } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed.zoom === "number" && typeof parsed.scrollX === "number" && typeof parsed.scrollY === "number") {
      return parsed;
    }
  } catch { /* ignore */ }
  return null;
}

function saveViewport(zoom: number, scrollX: number, scrollY: number) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ zoom, scrollX, scrollY }));
  } catch { /* ignore */ }
}

// ── WidgetCanvas ─────────────────────────────────────────────────────────────

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
  const scrollRef = useRef<HTMLDivElement>(null);
  const snapTimerRef = useRef<ReturnType<typeof setTimeout>>(null);
  const isSnappingRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(null);
  const restoredRef = useRef(false);

  const [zoomLevel, setZoomLevel] = useState(() => {
    const saved = loadViewport();
    return saved ? Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, saved.zoom)) : 0;
  });

  const zoomScale = 1 + zoomLevel * ZOOM_STEP;
  // Snap distances in scrollbar coordinates (base × zoom)
  const snapX = BASE_SNAP_X * zoomScale;
  const snapY = BASE_SNAP_Y * zoomScale;

  // ── Layout ──────────────────────────────────────────────────────────────

  const layout: Layout = useMemo(() => {
    return widgets.map((w): LayoutItem => {
      const reg = getWidget(w.type);
      return {
        i: w.id,
        x: w.x, y: w.y, w: w.w, h: w.h,
        minW: reg?.minW, minH: reg?.minH,
        maxW: reg?.maxW, maxH: reg?.maxH,
      };
    });
  }, [widgets]);

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
    [onLayoutChange],
  );

  // ── Restore viewport on mount ──────────────────────────────────────────

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || restoredRef.current) return;
    restoredRef.current = true;

    const saved = loadViewport();
    if (saved) {
      el.scrollLeft = saved.scrollX;
      el.scrollTop = saved.scrollY;
    } else {
      el.scrollLeft = (DEFAULT_ORIGIN_COL - 1) * BASE_SNAP_X * zoomScale;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Snap to grid after scroll stops + persist position ─────────────────

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const currentSnapX = BASE_SNAP_X * zoomScale;
    const currentSnapY = BASE_SNAP_Y * zoomScale;

    const handleScroll = () => {
      if (isSnappingRef.current) return;

      if (snapTimerRef.current) clearTimeout(snapTimerRef.current);
      snapTimerRef.current = setTimeout(() => {
        const snappedX = Math.round(el.scrollLeft / currentSnapX) * currentSnapX;
        const snappedY = Math.round(el.scrollTop / currentSnapY) * currentSnapY;

        if (Math.abs(el.scrollLeft - snappedX) > 1 || Math.abs(el.scrollTop - snappedY) > 1) {
          isSnappingRef.current = true;
          el.scrollTo({ left: snappedX, top: snappedY, behavior: "smooth" });
          setTimeout(() => { isSnappingRef.current = false; }, 200);
        }
      }, SNAP_DELAY);

      // Debounced save of scroll position
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveViewport(zoomLevel, el.scrollLeft, el.scrollTop);
      }, SAVE_DELAY);
    };

    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", handleScroll);
      if (snapTimerRef.current) clearTimeout(snapTimerRef.current);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [zoomScale, zoomLevel]);

  // ── Zoom ──────────────────────────────────────────────────────────────

  const handleZoom = useCallback((direction: 1 | -1) => {
    const el = scrollRef.current;
    if (!el) return;

    // Remember center position in grid coordinates (unzoomed)
    const centerCol = (el.scrollLeft + el.clientWidth / 2) / (BASE_SNAP_X * zoomScale);
    const centerRow = (el.scrollTop + el.clientHeight / 2) / (BASE_SNAP_Y * zoomScale);

    setZoomLevel((prev) => {
      const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev + direction));
      const newScale = 1 + next * ZOOM_STEP;

      // Scroll to keep the same center + persist
      requestAnimationFrame(() => {
        el.scrollLeft = centerCol * BASE_SNAP_X * newScale - el.clientWidth / 2;
        el.scrollTop = centerRow * BASE_SNAP_Y * newScale - el.clientHeight / 2;
        saveViewport(next, el.scrollLeft, el.scrollTop);
      });

      return next;
    });
  }, [zoomScale]);

  // ── Reset ─────────────────────────────────────────────────────────────

  const resetView = useCallback(() => {
    setZoomLevel(0);
    const el = scrollRef.current;
    if (!el) return;
    isSnappingRef.current = true;
    const resetX = (DEFAULT_ORIGIN_COL - 1) * BASE_SNAP_X;
    requestAnimationFrame(() => {
      el.scrollTo({ left: resetX, top: 0, behavior: "smooth" });
      saveViewport(0, resetX, 0);
      setTimeout(() => { isSnappingRef.current = false; }, 300);
    });
  }, []);

  // ── Canvas height ─────────────────────────────────────────────────────

  const canvasHeight = useMemo(() => {
    if (widgets.length === 0) return 20 * BASE_SNAP_Y;
    const maxBottom = Math.max(...widgets.map((w) => w.y + w.h));
    return (maxBottom + 10) * BASE_SNAP_Y;
  }, [widgets]);

  return (
    <div
      ref={scrollRef}
      className="w-full h-[calc(100vh-4rem)] overflow-auto pl-4"
    >
      {/* Zoom wrapper — CSS zoom scales everything uniformly:
          layout, fonts, borders, widget internals, pointer coords */}
      <div style={{ zoom: zoomScale }}>
        <div style={{ width: GRID_WIDTH, minHeight: canvasHeight }}>
          <GridLayout
            className="widget-grid-layout"
            layout={layout}
            width={GRID_WIDTH}
            gridConfig={{
              cols: GRID_COLS,
              rowHeight: ROW_HEIGHT,
              margin: [GAP, GAP] as [number, number],
              containerPadding: [0, 0] as [number, number],
              maxRows: Infinity,
            }}
            dragConfig={{
              enabled: true,
              bounded: false,
              handle: ".widget-drag-handle",
              threshold: 3,
            }}
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
        </div>
      </div>

      {/* Controls — sticky to bottom-left of viewport */}
      <div
        className="sticky bottom-4 left-4 inline-flex items-center gap-2 bg-surface/90 border border-primary/20 px-3 py-1.5 select-none z-50 ml-4"
      >
        <button
          onClick={() => handleZoom(-1)}
          disabled={zoomLevel <= MIN_ZOOM}
          className="text-xs text-text/50 hover:text-highlight disabled:text-text/15 transition-colors cursor-pointer px-1.5 py-0.5 border border-primary/20 hover:border-primary/40 disabled:cursor-default font-mono"
        >
          −
        </button>
        <span className="text-[10px] text-text/40 font-mono w-8 text-center">
          {zoomLevel === 0 ? "1x" : `${zoomLevel > 0 ? "+" : ""}${zoomLevel}`}
        </span>
        <button
          onClick={() => handleZoom(1)}
          disabled={zoomLevel >= MAX_ZOOM}
          className="text-xs text-text/50 hover:text-highlight disabled:text-text/15 transition-colors cursor-pointer px-1.5 py-0.5 border border-primary/20 hover:border-primary/40 disabled:cursor-default font-mono"
        >
          +
        </button>
        <div className="w-px h-3 bg-primary/20 mx-1" />
        <button
          onClick={resetView}
          className="text-[10px] text-text/50 hover:text-highlight transition-colors cursor-pointer px-1.5 py-0.5 border border-primary/20 hover:border-primary/40"
        >
          Reset
        </button>
      </div>
    </div>
  );
}

// ── WidgetWrapper ────────────────────────────────────────────────────────────

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
