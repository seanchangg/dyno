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

  // Expose toast on window for dev testing: window.__toast("msg", "success")
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__toast = toast;
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).__toast;
    };
  }, [toast]);

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
      {/* Toast container — fixed bottom-left, clear of sidebar */}
      <div className="fixed bottom-6 left-[276px] z-[70] flex flex-col gap-3 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={clsx(
              "pointer-events-auto px-5 py-3 text-base max-w-md cursor-pointer transition-all duration-300 border border-primary/30",
              typeStyles[t.type],
              t.exiting ? "opacity-0 -translate-x-4" : "opacity-100 translate-x-0"
            )}
            style={{ animation: t.exiting ? undefined : "toast-enter 0.35s ease-out" }}
            onClick={() => dismiss(t.id)}
          >
            <span className="flex items-center gap-3">
              {/* Mini Marty face */}
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="shrink-0">
                <rect width="24" height="24" fill="#2F5434" />
                <circle cx="8.6" cy="9" r="2" fill="#A8D5BA" />
                <circle cx="15.4" cy="9" r="2" fill="#A8D5BA" />
                <path d={
                  t.type === "error"
                    ? "M 8.4 15.5 Q 12 13 15.6 15.5"
                    : "M 8.4 14 Q 12 17 15.6 14"
                } stroke="#A8D5BA" strokeWidth="0.8" strokeLinecap="round" fill="none" />
              </svg>
              {t.message}
            </span>
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
