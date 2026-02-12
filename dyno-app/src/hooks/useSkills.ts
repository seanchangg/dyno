"use client";

import { useState, useEffect, useCallback } from "react";

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  tags: string[];
  tier: "bundled" | "managed" | "workspace";
}

export interface SkillDetail extends SkillInfo {
  content: string;
  filePath: string;
}

export function useSkills(userId?: string) {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [installed, setInstalled] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSkills = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/skills");
      if (!res.ok) throw new Error("Failed to fetch skills");
      const data = await res.json();
      setSkills(data.skills || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load skills");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchInstalled = useCallback(async () => {
    if (!userId) return;

    try {
      const res = await fetch(`/api/skills?path=/user/${userId}`);
      if (res.ok) {
        const data = await res.json();
        setInstalled(data.installed || []);
      }
    } catch {
      // Non-critical
    }
  }, [userId]);

  useEffect(() => {
    fetchSkills();
    fetchInstalled();
  }, [fetchSkills, fetchInstalled]);

  const install = useCallback(
    async (skillId: string) => {
      if (!userId) return false;
      try {
        const res = await fetch(`/api/skills`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ skillId, userId, action: "install" }),
        });
        if (res.ok) {
          setInstalled((prev) => [...prev, skillId]);
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    [userId]
  );

  const uninstall = useCallback(
    async (skillId: string) => {
      if (!userId) return false;
      try {
        const res = await fetch(`/api/skills`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ skillId, userId, action: "uninstall" }),
        });
        if (res.ok) {
          setInstalled((prev) => prev.filter((id) => id !== skillId));
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    [userId]
  );

  return {
    skills,
    installed,
    loading,
    error,
    install,
    uninstall,
    refresh: fetchSkills,
  };
}
