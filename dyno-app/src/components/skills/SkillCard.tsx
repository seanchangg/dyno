"use client";

import type { SkillInfo } from "@/hooks/useSkills";

interface SkillCardProps {
  skill: SkillInfo;
  isInstalled: boolean;
  onInstall: () => void;
  onUninstall: () => void;
  onViewDetail: () => void;
}

export default function SkillCard({
  skill,
  isInstalled,
  onInstall,
  onUninstall,
  onViewDetail,
}: SkillCardProps) {
  const tierColors = {
    bundled: "text-highlight",
    managed: "text-secondary",
    workspace: "text-text/70",
  };

  return (
    <div className="bg-surface border border-primary/20 p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <button
            onClick={onViewDetail}
            className="text-left text-highlight font-medium hover:underline truncate block w-full"
          >
            {skill.name}
          </button>
          <p className="text-xs text-text/50 mt-0.5">
            v{skill.version} by {skill.author}
          </p>
        </div>
        <span className={`text-xs ${tierColors[skill.tier]} shrink-0 ml-2`}>
          {skill.tier}
        </span>
      </div>

      <p className="text-sm text-text/70 line-clamp-2">
        {skill.description || "No description"}
      </p>

      {skill.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {skill.tags.map((tag) => (
            <span
              key={tag}
              className="text-xs bg-primary/20 text-text/60 px-2 py-0.5"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      <div className="mt-auto pt-2">
        {skill.tier === "bundled" ? (
          <span className="text-xs text-text/40">Always active</span>
        ) : isInstalled ? (
          <button
            onClick={onUninstall}
            className="text-xs text-text/50 hover:text-highlight transition-colors"
          >
            Uninstall
          </button>
        ) : (
          <button
            onClick={onInstall}
            className="text-xs bg-primary text-highlight px-3 py-1 hover:bg-secondary transition-colors"
          >
            Install
          </button>
        )}
      </div>
    </div>
  );
}
