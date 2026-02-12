"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { clsx } from "clsx";

type ToastType = "error" | "success" | "info";

interface Toast {
  id: string;
  message: string;
  type: ToastType;
  exiting?: boolean;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TOAST_DURATION = 4000;
const EXIT_DURATION = 300;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    // Start exit animation
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)));
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, EXIT_DURATION);
  }, []);

  const toast = useCallback(
    (message: string, type: ToastType = "error") => {
      const id = crypto.randomUUID();
      setToasts((prev) => [...prev, { id, message, type }]);

      const timer = setTimeout(() => {
        dismiss(id);
        timersRef.current.delete(id);
      }, TOAST_DURATION);
      timersRef.current.set(id, timer);
    },
    [dismiss]
  );

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      timersRef.current.forEach((timer) => clearTimeout(timer));
    };
  }, []);

  const typeStyles: Record<ToastType, string> = {
    error: "bg-danger text-text",
    success: "bg-primary text-text",
    info: "bg-surface text-text border border-secondary/30",
  };

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {/* Toast container — fixed bottom-right */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={clsx(
              "pointer-events-auto px-4 py-2.5 text-sm max-w-sm cursor-pointer transition-all duration-300",
              typeStyles[t.type],
              t.exiting ? "opacity-0 translate-x-4" : "opacity-100 translate-x-0"
            )}
            style={{ animation: t.exiting ? undefined : "toast-in 0.3s ease-out" }}
            onClick={() => dismiss(t.id)}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a <ToastProvider>");
  }
  return ctx;
}
