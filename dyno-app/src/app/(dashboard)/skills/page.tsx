"use client";

import { useState } from "react";
import { useSkills, type SkillInfo } from "@/hooks/useSkills";
import { useAuth } from "@/hooks/useAuth";
import SkillCard from "@/components/skills/SkillCard";
import SkillDetail from "@/components/skills/SkillDetail";

export default function SkillsPage() {
  const { user } = useAuth();
  const { skills, installed, loading, error, install, uninstall } =
    useSkills(user?.id);
  const [selectedSkill, setSelectedSkill] = useState<SkillInfo | null>(null);
  const [filter, setFilter] = useState<"all" | "installed" | "bundled" | "managed">("all");

  const filteredSkills = skills.filter((skill) => {
    if (filter === "installed") return installed.includes(skill.id) || skill.tier === "bundled";
    if (filter === "bundled") return skill.tier === "bundled";
    if (filter === "managed") return skill.tier === "managed";
    return true;
  });

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
            <SkillCard
              key={skill.id}
              skill={skill}
              isInstalled={installed.includes(skill.id)}
              onInstall={() => install(skill.id)}
              onUninstall={() => uninstall(skill.id)}
              onViewDetail={() => setSelectedSkill(skill)}
            />
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
