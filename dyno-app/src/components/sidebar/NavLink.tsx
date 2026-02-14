"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import type { LucideIcon } from "lucide-react";

interface NavLinkProps {
  href: string;
  label: string;
  icon: LucideIcon;
}

export default function NavLink({ href, label, icon: Icon }: NavLinkProps) {
  const pathname = usePathname();
  const isActive = pathname === href;

  return (
    <Link
      href={href}
      className={clsx(
        "group flex items-center gap-3 px-4 py-2.5 text-sm font-medium transition-all duration-200 border-l-2",
        isActive
          ? "bg-primary/30 text-highlight border-highlight animate-[nav-border-pulse_3s_ease-in-out_infinite]"
          : "text-text/70 border-transparent hover:bg-primary/10 hover:text-text hover:border-secondary"
      )}
    >
      <Icon
        size={18}
        className={clsx(
          "transition-transform duration-200",
          !isActive && "group-hover:translate-x-0.5"
        )}
      />
      {label}
    </Link>
  );
}
