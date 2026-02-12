"use client";

import AuthGuard from "@/components/auth/AuthGuard";
import Sidebar from "@/components/sidebar/Sidebar";
import { ToastProvider } from "@/components/ui/ToastProvider";
import { WidgetLayoutProvider } from "@/hooks/useWidgetLayoutContext";
import { DashboardSessionBridge } from "@/components/DashboardSessionBridge";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard>
      <ToastProvider>
        <WidgetLayoutProvider>
          <DashboardSessionBridge>
            <div className="flex min-h-screen bg-background">
              <Sidebar />
              <main className="ml-[260px] flex-1 overflow-y-auto p-8">
                {children}
              </main>
            </div>
          </DashboardSessionBridge>
        </WidgetLayoutProvider>
      </ToastProvider>
    </AuthGuard>
  );
}
