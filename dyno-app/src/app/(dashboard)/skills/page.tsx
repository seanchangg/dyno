"use client";

import { useState, useCallback } from "react";
import { useSkills, type SkillInfo } from "@/hooks/useSkills";
import { useAuth } from "@/hooks/useAuth";
import { useServerStatus } from "@/hooks/useServerStatus";
import { useToast } from "@/components/ui/ToastProvider";
import { authFetch } from "@/lib/api";
import type { PermissionMode } from "@/types";
import SkillCard from "@/components/skills/SkillCard";
import SkillDetail from "@/components/skills/SkillDetail";

export default function SkillsPage() {
  const { user } = useAuth();
  const { skills, installed, loading, error, install, uninstall } =
    useSkills(user?.id);
  const [selectedSkill, setSelectedSkill] = useState<SkillInfo | null>(null);
  const [filter, setFilter] = useState<"all" | "installed" | "bundled" | "managed">("all");
  const [expandedSkillId, setExpandedSkillId] = useState<string | null>(null);

  const server = useServerStatus();
  const { toast } = useToast();

  const toggleToolMode = useCallback(
    async (toolName: string, currentMode: "auto" | "manual") => {
      const newMode: PermissionMode = currentMode === "auto" ? "manual" : "auto";
      try {
        await authFetch("/api/tool-permissions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tool: toolName, mode: newMode }),
        });
        server.refresh();
      } catch {
        toast("Failed to update tool permission", "error");
      }
    },
    [server, toast]
  );

  const resetToolOverrides = useCallback(async () => {
    try {
      await authFetch("/api/tool-permissions", { method: "DELETE" });
      server.refresh();
    } catch {
      toast("Failed to reset permissions", "error");
    }
  }, [server, toast]);

  const filteredSkills = skills.filter((skill) => {
    if (filter === "installed") return installed.includes(skill.id) || skill.tier === "bundled";
    if (filter === "bundled") return skill.tier === "bundled";
    if (filter === "managed") return skill.tier === "managed";
    return true;
  });

  const handleCardClick = (skill: SkillInfo) => {
    if (skill.tier === "bundled") {
      setExpandedSkillId((prev) => (prev === skill.id ? null : skill.id));
    } else {
      setSelectedSkill(skill);
    }
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-highlight">Skills</h1>
          <p className="text-sm text-text/50 mt-1">
            Extend your agent with community skills
          </p>
        </div>
      </div>

      <div className="flex gap-2 mb-6">
        {(["all", "installed", "bundled", "managed"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-sm px-3 py-1 transition-colors ${
              filter === f
                ? "bg-primary text-highlight"
                : "text-text/50 hover:text-highlight"
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-text/50">Loading skills...</p>
      ) : error ? (
        <p className="text-red-400">{error}</p>
      ) : filteredSkills.length === 0 ? (
        <p className="text-text/50">No skills found.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredSkills.map((skill) => (
            <div key={skill.id} className={skill.tier === "bundled" && expandedSkillId === skill.id ? "col-span-full" : ""}>
              <SkillCard
                skill={skill}
                isInstalled={installed.includes(skill.id)}
                onInstall={() => install(skill.id)}
                onUninstall={() => uninstall(skill.id)}
                onViewDetail={() => handleCardClick(skill)}
                expanded={skill.tier === "bundled" && expandedSkillId === skill.id}
              />
              {skill.tier === "bundled" && expandedSkillId === skill.id && (
                <div className="bg-surface border border-t-0 border-primary/20 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-xs font-semibold text-text/70">
                      Tool Permissions
                    </h2>
                    <div className="flex items-center gap-3">
                      {server.tools.some((t) => t.overridden) && (
                        <button
                          onClick={resetToolOverrides}
                          className="text-xs text-text/30 hover:text-text/60 transition-colors cursor-pointer"
                        >
                          Reset to defaults
                        </button>
                      )}
                      <span className="text-xs text-text/30">
                        {server.tools.length} tools
                      </span>
                    </div>
                  </div>
                  {server.tools.length === 0 && (
                    <p className="text-xs text-text/30">
                      {server.online ? "No tools loaded." : "Gateway offline."}
                    </p>
                  )}
                  <div className="grid grid-cols-1 gap-1.5">
                    {server.tools.map((tool) => (
                      <div
                        key={tool.name}
                        className="flex items-center justify-between text-sm"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-mono text-xs bg-primary/30 text-highlight px-1.5 py-0.5 shrink-0">
                            {tool.name}
                          </span>
                          <span className="text-text/50 text-xs truncate">
                            {tool.description}
                          </span>
                        </div>
                        <button
                          onClick={() => toggleToolMode(tool.name, tool.mode)}
                          className={`text-xs font-medium px-2.5 py-0.5 shrink-0 ml-3 cursor-pointer transition-colors ${
                            tool.mode === "auto"
                              ? "bg-highlight/15 text-highlight/70 hover:bg-highlight/25"
                              : "bg-primary/20 text-text/50 hover:bg-primary/30"
                          } ${tool.overridden ? "ring-1 ring-secondary/40" : ""}`}
                        >
                          {tool.mode}
                        </button>
                      </div>
                    ))}
                  </div>
                  {server.tools.length > 0 && (
                    <p className="text-xs text-text/25 mt-3">
                      Click a tool&apos;s mode to toggle between auto and manual.
                      Auto tools run without approval.
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {selectedSkill && (
        <SkillDetail
          skill={selectedSkill}
          content={null}
          isInstalled={installed.includes(selectedSkill.id)}
          onInstall={() => install(selectedSkill.id)}
          onUninstall={() => uninstall(selectedSkill.id)}
          onClose={() => setSelectedSkill(null)}
        />
      )}
    </div>
  );
}
