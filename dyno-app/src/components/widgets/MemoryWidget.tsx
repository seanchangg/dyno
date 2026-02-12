"use client";

import React, { useState } from "react";
import MemoryTable from "@/components/chat/MemoryTable";
import { useMemories } from "@/hooks/useMemories";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/components/ui/ToastProvider";

function MemoryWidget() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { memories, saveMemory, deleteMemory } = useMemories(user?.id, {
    onError: (msg) => toast(msg, "error"),
  });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggleMemory = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="h-full">
      <MemoryTable
        memories={memories}
        selectedIds={selectedIds}
        onToggle={toggleMemory}
        onDelete={(id) => {
          deleteMemory(id);
          setSelectedIds((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
        }}
        onSave={saveMemory}
      />
    </div>
  );
}

export default React.memo(MemoryWidget);
