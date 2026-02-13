"use client";

import { LayoutDashboard, FlaskConical, FileText, Settings, Puzzle, HardDrive } from "lucide-react";
import DynoSprite from "@/components/sprite/DynoSprite";
import NavLink from "./NavLink";
import { useAgentStatus } from "@/hooks/useAgentStatus";
import { useAuth } from "@/hooks/useAuth";

const baseNavItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/agent-lab", label: "Agent Lab", icon: FlaskConical },
  { href: "/skills", label: "Skills", icon: Puzzle },
  { href: "/context", label: "Context", icon: FileText },
  { href: "/vault", label: "Vault", icon: HardDrive },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function Sidebar() {
  const { status } = useAgentStatus();
  const { profile, signOut } = useAuth();

  return (
    <aside className="fixed left-0 top-0 z-30 flex h-screen w-[260px] flex-col bg-surface border-r border-primary/20">
      <div className="flex items-center gap-3 px-5 py-6">
        <DynoSprite status={status} size={40} />
        <div>
          <h1 className="text-lg font-bold tracking-wide text-highlight">
            MARTY
          </h1>
          <p className="text-xs text-text/50 capitalize">{status}</p>
        </div>
      </div>

      <nav className="flex-1 flex flex-col gap-0.5 px-2">
        {baseNavItems.map((item) => (
          <NavLink key={item.href} {...item} />
        ))}
      </nav>

      <div className="border-t border-primary/20 px-5 py-4">
        <p className="text-sm text-text/70 truncate">
          {profile?.full_name || profile?.username || "User"}
        </p>
        <button
          onClick={signOut}
          className="mt-1 text-xs text-text/40 hover:text-highlight transition-colors"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
