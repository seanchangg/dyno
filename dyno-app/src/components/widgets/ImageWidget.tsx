"use client";

import React from "react";

interface ImageWidgetProps {
  src?: string;
  alt?: string;
}

function ImageWidget({ src, alt = "Image" }: ImageWidgetProps) {
  return (
    <div className="h-full overflow-hidden bg-surface border border-primary/20 flex items-center justify-center">
      {src ? (
        <img
          src={src}
          alt={alt}
          className="max-w-full max-h-full object-contain"
        />
      ) : (
        <p className="text-xs text-text/30">No image source</p>
      )}
    </div>
  );
}

export default React.memo(ImageWidget);
