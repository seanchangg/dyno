"use client";

import React from "react";

interface HtmlWidgetProps {
  html?: string;
  src?: string;
  title?: string;
}

function HtmlWidget({ html, src, title = "HTML Widget" }: HtmlWidgetProps) {
  if (src) {
    return (
      <iframe
        src={src}
        title={title}
        sandbox="allow-scripts allow-same-origin"
        style={{
          width: "100%",
          height: "100%",
          border: "none",
          background: "transparent",
        }}
      />
    );
  }

  if (html) {
    return (
      <iframe
        srcDoc={html}
        title={title}
        sandbox="allow-scripts"
        style={{
          width: "100%",
          height: "100%",
          border: "none",
          background: "transparent",
        }}
      />
    );
  }

  return (
    <div className="h-full flex items-center justify-center text-text/50 text-sm">
      No HTML content provided
    </div>
  );
}

export default React.memo(HtmlWidget);
