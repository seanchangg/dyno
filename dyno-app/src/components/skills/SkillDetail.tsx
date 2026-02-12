"use client";

import type { SkillInfo } from "@/hooks/useSkills";

interface SkillDetailProps {
  skill: SkillInfo;
  content: string | null;
  isInstalled: boolean;
  onInstall: () => void;
  onUninstall: () => void;
  onClose: () => void;
}

export default function SkillDetail({
  skill,
  content,
  isInstalled,
  onInstall,
  onUninstall,
  onClose,
}: SkillDetailProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80">
      <div className="bg-surface border border-primary/20 w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-primary/20">
          <div>
            <h2 className="text-lg font-bold text-highlight">{skill.name}</h2>
            <p className="text-xs text-text/50">
              v{skill.version} by {skill.author} &middot; {skill.tier}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {skill.tier !== "bundled" && (
              isInstalled ? (
                <button
                  onClick={onUninstall}
                  className="text-sm text-text/50 hover:text-highlight transition-colors"
                >
                  Uninstall
                </button>
              ) : (
                <button
                  onClick={onInstall}
                  className="text-sm bg-primary text-highlight px-4 py-1 hover:bg-secondary transition-colors"
                >
                  Install
                </button>
              )
            )}
            <button
              onClick={onClose}
              className="text-text/40 hover:text-highlight transition-colors text-lg"
            >
              &times;
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {skill.description && (
            <p className="text-sm text-text/70 mb-4">{skill.description}</p>
          )}

          {skill.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-4">
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

          {content && (
            <div className="border-t border-primary/20 pt-4">
              <h3 className="text-sm font-medium text-text/50 mb-2">
                Skill Content
              </h3>
              <pre className="text-xs text-text/60 whitespace-pre-wrap font-mono bg-background p-3 overflow-x-auto">
                {content}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
