"use client";

import { useState } from "react";
import { clsx } from "clsx";
import Button from "@/components/ui/Button";
import Collapsible from "@/components/ui/Collapsible";
import DiffView from "./DiffView";
import type { ProposedAction } from "@/types";

interface ProposedActionCardProps {
  action: ProposedAction;
  onApprove: (id: string, editedInput?: Record<string, string>) => void;
  onDeny: (id: string) => void;
}

const STATUS_STYLES: Record<string, string> = {
  pending: "border-highlight/40",
  approved: "border-highlight/20 opacity-80",
  denied: "border-danger/30 opacity-60",
  executing: "border-highlight/60",
  completed: "border-highlight/20 opacity-70",
  failed: "border-danger/30 opacity-60",
};

const STATUS_LABELS: Record<string, { text: string; color: string }> = {
  pending: { text: "Pending", color: "text-highlight" },
  approved: { text: "Approved", color: "text-highlight/70" },
  denied: { text: "Denied", color: "text-danger" },
  executing: { text: "Executing...", color: "text-highlight" },
  completed: { text: "Completed", color: "text-highlight/60" },
  failed: { text: "Failed", color: "text-danger" },
};

export default function ProposedActionCard({
  action,
  onApprove,
  onDeny,
}: ProposedActionCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState(
    action.input.content || ""
  );

  const statusInfo = STATUS_LABELS[action.status] || STATUS_LABELS.pending;
  const isPending = action.status === "pending";
  const isModifyFile = action.tool === "modify_file";
  const hasCostInfo =
    action.tokensIn !== undefined || action.tokensOut !== undefined;

  const handleApprove = () => {
    if (isEditing && editedContent !== action.input.content) {
      onApprove(action.id, { ...action.input, content: editedContent });
    } else {
      onApprove(action.id);
    }
    setIsEditing(false);
  };

  return (
    <div
      className={clsx(
        "bg-surface border p-4 transition-all duration-200",
        STATUS_STYLES[action.status]
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono bg-primary/30 text-highlight px-2 py-0.5">
            {action.tool}
          </span>
          <span className="text-sm text-text">{action.displayTitle}</span>
        </div>
        <span className={clsx("text-xs font-medium", statusInfo.color)}>
          {statusInfo.text}
        </span>
      </div>

      {/* Cost info */}
      {hasCostInfo && isPending && (
        <div className="flex items-center gap-4 text-xs text-text/40 mb-3 border-b border-primary/10 pb-2">
          {action.iteration && (
            <span>Iteration {action.iteration}</span>
          )}
          <span>
            {(action.tokensIn ?? 0).toLocaleString()} in /{" "}
            {(action.tokensOut ?? 0).toLocaleString()} out
          </span>
          {action.costSoFar !== undefined && (
            <span className="ml-auto text-text/50">
              Cost so far: ${action.costSoFar.toFixed(4)}
            </span>
          )}
        </div>
      )}

      {/* Content preview */}
      {isModifyFile && action.input.old_string && action.input.new_string ? (
        <Collapsible title="Diff View" defaultOpen={isPending}>
          <DiffView
            oldText={action.input.old_string}
            newText={action.input.new_string}
          />
        </Collapsible>
      ) : action.input.content ? (
        <Collapsible title="Code Preview" defaultOpen={isPending}>
          {isEditing ? (
            <textarea
              value={editedContent}
              onChange={(e) => setEditedContent(e.target.value)}
              className="w-full bg-background border border-primary/30 p-3 font-mono text-xs text-text focus:outline-none focus:border-highlight min-h-[200px] resize-y"
            />
          ) : (
            <pre className="text-xs text-text/70 whitespace-pre-wrap font-mono max-h-[300px] overflow-y-auto">
              {action.input.content}
            </pre>
          )}
        </Collapsible>
      ) : action.input.package_name ? (
        <p className="text-sm text-text/50 mb-3">
          Package: {action.input.package_name}
        </p>
      ) : null}

      {/* Result/error display */}
      {action.result && (
        <p className="text-xs text-highlight/60 mt-2">{action.result}</p>
      )}
      {action.error && (
        <p className="text-xs text-danger mt-2">{action.error}</p>
      )}

      {/* Action buttons */}
      {isPending && (
        <div className="flex gap-2 mt-3">
          <Button onClick={handleApprove} className="text-sm px-3 py-1.5">
            {isEditing ? "Approve (Edited)" : "Approve"}
          </Button>
          <Button
            variant="secondary"
            onClick={() => onDeny(action.id)}
            className="text-sm px-3 py-1.5"
          >
            Deny
          </Button>
          {action.input.content && !isEditing && (
            <Button
              variant="ghost"
              onClick={() => setIsEditing(true)}
              className="text-sm px-3 py-1.5"
            >
              Edit
            </Button>
          )}
          {isEditing && (
            <Button
              variant="ghost"
              onClick={() => {
                setIsEditing(false);
                setEditedContent(action.input.content || "");
              }}
              className="text-sm px-3 py-1.5"
            >
              Cancel Edit
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
