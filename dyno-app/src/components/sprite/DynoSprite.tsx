"use client";

import { clsx } from "clsx";
import type { AgentStatus } from "@/types";

interface DynoSpriteProps {
  status: AgentStatus;
  size?: number;
}

export default function DynoSprite({ status, size = 64 }: DynoSpriteProps) {
  const eyeSize = size * 0.08;
  const eyeY = size * 0.38;
  const leftEyeX = size * 0.36;
  const rightEyeX = size * 0.64;
  const mouthY = size * 0.58;

  return (
    <div
      className={clsx(
        "relative flex items-center justify-center",
        status === "online" && "animate-[pulse-glow_2s_ease-in-out_infinite]",
        status === "working" && "animate-[spin_3s_linear_infinite]",
        status === "offline" && "grayscale opacity-60"
      )}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        fill="none"
      >
        <rect
          width={size}
          height={size}
          fill={status === "offline" ? "#3a3a3a" : "#2F5434"}
        />

        {/* Left eye */}
        <circle cx={leftEyeX} cy={eyeY} r={eyeSize} fill="#A8D5BA" />
        {/* Right eye */}
        <circle cx={rightEyeX} cy={eyeY} r={eyeSize} fill="#A8D5BA" />

        {/* Mouth */}
        {status === "online" && (
          <path
            d={`M ${size * 0.35} ${mouthY} Q ${size * 0.5} ${mouthY + size * 0.12} ${size * 0.65} ${mouthY}`}
            stroke="#A8D5BA"
            strokeWidth={size * 0.03}
            strokeLinecap="round"
            fill="none"
          />
        )}
        {status === "working" && (
          <line
            x1={size * 0.38}
            y1={mouthY + size * 0.04}
            x2={size * 0.62}
            y2={mouthY + size * 0.04}
            stroke="#A8D5BA"
            strokeWidth={size * 0.03}
            strokeLinecap="round"
          />
        )}
        {status === "offline" && (
          <path
            d={`M ${size * 0.35} ${mouthY + size * 0.08} Q ${size * 0.5} ${mouthY - size * 0.04} ${size * 0.65} ${mouthY + size * 0.08}`}
            stroke="#888"
            strokeWidth={size * 0.03}
            strokeLinecap="round"
            fill="none"
          />
        )}
      </svg>
    </div>
  );
}
