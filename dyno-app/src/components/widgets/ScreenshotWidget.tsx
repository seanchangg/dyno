"use client";

import React, { useState, useMemo } from "react";
import { useScreenshotSelection } from "@/hooks/useScreenshotSelection";

function ScreenshotWidget() {
  const {
    screenshots,
    loading,
    selectedIds,
    toggleScreenshot,
    deleteScreenshot,
    refresh,
  } = useScreenshotSelection();
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim()) return screenshots;
    const q = search.toLowerCase();
    return screenshots.filter((s) => s.filename.toLowerCase().includes(q));
  }, [screenshots, search]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-surface">
        <span className="text-xs text-text/30">Loading screenshots...</span>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-surface border border-primary/20">
      <div className="border-b border-primary/20 px-3 py-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-highlight shrink-0">Screenshots</h2>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <span className="text-[10px] text-highlight/50">
              {selectedIds.size} selected
            </span>
          )}
          <button
            onClick={refresh}
            className="text-[10px] text-text/40 hover:text-highlight transition-colors cursor-pointer"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="px-3 py-2 border-b border-primary/10">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by filename..."
          className="w-full bg-background border border-primary/20 px-2 py-1 text-xs text-text placeholder:text-text/30 focus:outline-none focus:border-highlight/40 transition-colors"
        />
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {filtered.length === 0 ? (
          <p className="text-xs text-text/30 text-center mt-4">
            {screenshots.length === 0
              ? "No screenshots yet. Agent will capture them during tasks."
              : "No screenshots match your filter."}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {filtered.map((s) => {
              const isSelected = selectedIds.has(s.id);
              return (
                <div
                  key={s.id}
                  className={`relative group border transition-colors cursor-pointer ${
                    isSelected
                      ? "border-highlight/50 bg-highlight/5"
                      : "border-primary/20 hover:border-secondary/40"
                  }`}
                  onClick={() => toggleScreenshot(s.id)}
                >
                  <div className="aspect-video bg-background overflow-hidden">
                    <img
                      src={s.publicUrl}
                      alt={s.filename}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  </div>
                  <div className="px-1.5 py-1 flex items-center justify-between gap-1">
                    <span className="text-[10px] text-text/50 truncate flex-1">
                      {s.filename}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteScreenshot(s.id);
                      }}
                      className="text-[10px] text-text/20 hover:text-danger/60 transition-colors cursor-pointer opacity-0 group-hover:opacity-100"
                    >
                      delete
                    </button>
                  </div>
                  {isSelected && (
                    <div className="absolute top-1 right-1 w-4 h-4 bg-highlight/80 flex items-center justify-center">
                      <span className="text-[10px] text-background font-bold">
                        &#10003;
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default React.memo(ScreenshotWidget);
