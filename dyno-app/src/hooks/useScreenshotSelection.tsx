"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { useScreenshots, type Screenshot } from "./useScreenshots";
import { useAuth } from "./useAuth";
import { useToast } from "@/components/ui/ToastProvider";

interface ScreenshotSelectionContextValue {
  screenshots: Screenshot[];
  loading: boolean;
  selectedIds: Set<string>;
  toggleScreenshot: (id: string) => void;
  clearSelection: () => void;
  refresh: () => void;
  deleteScreenshot: (id: string) => Promise<void>;
}

const ScreenshotSelectionContext = createContext<ScreenshotSelectionContextValue | null>(null);

export function ScreenshotSelectionProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { screenshots, loading, refresh, deleteScreenshot } = useScreenshots(user?.id, {
    onError: (msg) => toast(msg, "error"),
  });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggleScreenshot = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteScreenshot(id);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    },
    [deleteScreenshot]
  );

  return (
    <ScreenshotSelectionContext.Provider
      value={{
        screenshots,
        loading,
        selectedIds,
        toggleScreenshot,
        clearSelection,
        refresh,
        deleteScreenshot: handleDelete,
      }}
    >
      {children}
    </ScreenshotSelectionContext.Provider>
  );
}

export function useScreenshotSelection() {
  const ctx = useContext(ScreenshotSelectionContext);
  if (!ctx) {
    throw new Error("useScreenshotSelection must be used within a <ScreenshotSelectionProvider>");
  }
  return ctx;
}
