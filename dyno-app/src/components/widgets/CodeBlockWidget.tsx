"use client";

import React from "react";

interface CodeBlockWidgetProps {
  code?: string;
  language?: string;
}

function CodeBlockWidget({ code = "", language }: CodeBlockWidgetProps) {
  return (
    <div className="h-full overflow-auto bg-surface border border-primary/20">
      <div className="border-b border-primary/20 px-4 py-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold text-highlight">Code</h2>
        {language && (
          <span className="text-[10px] font-mono text-text/30">{language}</span>
        )}
      </div>
      <pre className="p-4 text-xs font-mono text-text/80 overflow-auto">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export default React.memo(CodeBlockWidget);
