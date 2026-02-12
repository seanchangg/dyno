"use client";

import { useState } from "react";
import Card from "@/components/ui/Card";
import LoginForm from "@/components/auth/LoginForm";
import SignupForm from "@/components/auth/SignupForm";
import DynoSprite from "@/components/sprite/DynoSprite";
import { clsx } from "clsx";

type Tab = "login" | "signup";

export default function LoginPage() {
  const [tab, setTab] = useState<Tab>("login");

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-3">
          <DynoSprite status="online" size={56} />
          <h1 className="text-2xl font-bold tracking-wide text-highlight">
            DYNO
          </h1>
          <p className="text-sm text-text/50">Personal Agent Dashboard</p>
        </div>

        <div className="mb-6 flex border-b border-primary/20">
          {(["login", "signup"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={clsx(
                "flex-1 py-2.5 text-sm font-medium transition-colors",
                tab === t
                  ? "border-b-2 border-highlight text-highlight"
                  : "text-text/50 hover:text-text/70"
              )}
            >
              {t === "login" ? "Sign In" : "Sign Up"}
            </button>
          ))}
        </div>

        {tab === "login" ? (
          <LoginForm />
        ) : (
          <SignupForm onSwitchToLogin={() => setTab("login")} />
        )}
      </Card>
    </div>
  );
}
