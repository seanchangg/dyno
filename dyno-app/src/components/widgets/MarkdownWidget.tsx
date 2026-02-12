"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownWidgetProps {
  content?: string;
}

function MarkdownWidget({ content = "" }: MarkdownWidgetProps) {
  return (
    <div className="h-full overflow-y-auto bg-surface border border-primary/20 p-4">
      <div className="markdown-body text-sm text-text">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
}

export default React.memo(MarkdownWidget);
