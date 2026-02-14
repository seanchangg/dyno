"use client";

import { useEffect, useRef, useCallback } from "react";
import { clsx } from "clsx";
import type { AgentStatus } from "@/types";

interface DynoSpriteProps {
  status: AgentStatus;
  size?: number;
  /** Disable cursor tracking (e.g. in small contexts) */
  noTrack?: boolean;
}

export default function DynoSprite({ status, size = 64, noTrack = false }: DynoSpriteProps) {
  const leftEyeRef = useRef<SVGEllipseElement>(null);
  const rightEyeRef = useRef<SVGEllipseElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);

  // Base positions
  const eyeRadius = size * 0.08;
  const eyeY = size * 0.38;
  const leftEyeCX = size * 0.36;
  const rightEyeCX = size * 0.64;
  const mouthY = size * 0.58;
  const maxEyeShift = size * 0.04;
  // ── Cursor tracking (online only) ──────────────────────────────────────

  const onMouseMove = useCallback((e: MouseEvent) => {
    const el = containerRef.current;
    const le = leftEyeRef.current;
    const re = rightEyeRef.current;
    if (!el || !le || !re) return;

    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);

    const maxDist = Math.max(window.innerWidth, window.innerHeight) * 0.5;
    const nx = (dx / Math.max(dist, 1)) * Math.min(dist / maxDist, 1) * maxEyeShift;
    const ny = (dy / Math.max(dist, 1)) * Math.min(dist / maxDist, 1) * maxEyeShift;

    le.setAttribute("cx", String(leftEyeCX + nx));
    le.setAttribute("cy", String(eyeY + ny));
    re.setAttribute("cx", String(rightEyeCX + nx));
    re.setAttribute("cy", String(eyeY + ny));
  }, [leftEyeCX, rightEyeCX, eyeY, maxEyeShift]);

  useEffect(() => {
    if (noTrack || status !== "online") return;
    window.addEventListener("mousemove", onMouseMove);
    return () => window.removeEventListener("mousemove", onMouseMove);
  }, [noTrack, status, onMouseMove]);

  // ── Thinking animation (working) ───────────────────────────────────────

  useEffect(() => {
    if (status !== "working") {
      cancelAnimationFrame(animRef.current);
      const le = leftEyeRef.current;
      const re = rightEyeRef.current;
      if (le && re && status !== "sleeping") {
        le.setAttribute("cx", String(leftEyeCX));
        le.setAttribute("cy", String(eyeY));
        re.setAttribute("cx", String(rightEyeCX));
        re.setAttribute("cy", String(eyeY));
        le.setAttribute("ry", String(eyeRadius));
        re.setAttribute("ry", String(eyeRadius));
      }
      return;
    }

    const le = leftEyeRef.current;
    const re = rightEyeRef.current;
    if (!le || !re) return;

    const driftX = maxEyeShift * 0.9;
    const driftY = maxEyeShift * 0.7;
    const duration = 3200;

    const animate = () => {
      const t = (Date.now() % duration) / duration;
      let dx: number, dy: number;

      if (t < 0.25) {
        const p = t / 0.25;
        const ease = p * p * (3 - 2 * p);
        dx = -driftX * ease;
        dy = -driftY * ease;
      } else if (t < 0.5) {
        dx = -driftX;
        dy = -driftY;
      } else if (t < 0.75) {
        const p = (t - 0.5) / 0.25;
        const ease = p * p * (3 - 2 * p);
        dx = -driftX + 2 * driftX * ease;
        dy = -driftY;
      } else {
        const p = (t - 0.75) / 0.25;
        const ease = p * p * (3 - 2 * p);
        dx = driftX * (1 - ease);
        dy = -driftY * (1 - ease);
      }

      le.setAttribute("cx", String(leftEyeCX + dx));
      le.setAttribute("cy", String(eyeY + dy));
      re.setAttribute("cx", String(rightEyeCX + dx));
      re.setAttribute("cy", String(eyeY + dy));

      animRef.current = requestAnimationFrame(animate);
    };

    animRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animRef.current);
  }, [status, size, leftEyeCX, rightEyeCX, eyeY, maxEyeShift, eyeRadius]);

  // ── Sleeping animation (eyes closed, gentle breathing) ─────────────────

  useEffect(() => {
    if (status !== "sleeping") return;

    const le = leftEyeRef.current;
    const re = rightEyeRef.current;
    if (!le || !re) return;

    // Close eyes immediately
    le.setAttribute("cx", String(leftEyeCX));
    le.setAttribute("cy", String(eyeY));
    re.setAttribute("cx", String(rightEyeCX));
    re.setAttribute("cy", String(eyeY));
    le.style.transition = "ry 0.4s ease-out";
    re.style.transition = "ry 0.4s ease-out";
    le.setAttribute("ry", String(eyeRadius * 0.12));
    re.setAttribute("ry", String(eyeRadius * 0.12));

    return () => {
      // Open eyes on wake
      le.style.transition = "ry 0.2s ease-out";
      re.style.transition = "ry 0.2s ease-out";
      le.setAttribute("ry", String(eyeRadius));
      re.setAttribute("ry", String(eyeRadius));
    };
  }, [status, leftEyeCX, rightEyeCX, eyeY, eyeRadius]);

  // ── Random idle blink (online only) ────────────────────────────────────

  useEffect(() => {
    if (status !== "online") return;
    const le = leftEyeRef.current;
    const re = rightEyeRef.current;
    if (!le || !re) return;

    let timeout: ReturnType<typeof setTimeout>;

    const blink = () => {
      le.style.transition = "ry 0.06s ease-in";
      re.style.transition = "ry 0.06s ease-in";
      le.setAttribute("ry", String(eyeRadius * 0.15));
      re.setAttribute("ry", String(eyeRadius * 0.15));

      setTimeout(() => {
        le.style.transition = "ry 0.1s ease-out";
        re.style.transition = "ry 0.1s ease-out";
        le.setAttribute("ry", String(eyeRadius));
        re.setAttribute("ry", String(eyeRadius));
      }, 120);

      timeout = setTimeout(blink, 3000 + Math.random() * 4000);
    };

    timeout = setTimeout(blink, 2000 + Math.random() * 3000);
    return () => clearTimeout(timeout);
  }, [status, eyeRadius]);

  // ── Animation style per status ─────────────────────────────────────────

  const containerAnimation = (() => {
    switch (status) {
      case "online":
        return "sprite-bob 4s ease-in-out infinite, pulse-glow 2s ease-in-out infinite";
      case "sleeping":
        return "sprite-bob 6s ease-in-out infinite";
      default:
        return undefined;
    }
  })();

  return (
    <div
      ref={containerRef}
      className={clsx(
        "relative flex items-center justify-center",
        status === "offline" && "grayscale opacity-60",
        status === "sleeping" && "opacity-70",
      )}
      style={{
        width: size,
        height: size,
        animation: containerAnimation,
      }}
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
        <ellipse
          ref={leftEyeRef}
          cx={leftEyeCX}
          cy={eyeY}
          rx={eyeRadius}
          ry={eyeRadius}
          fill="#A8D5BA"
        />
        {/* Right eye */}
        <ellipse
          ref={rightEyeRef}
          cx={rightEyeCX}
          cy={eyeY}
          rx={eyeRadius}
          ry={eyeRadius}
          fill="#A8D5BA"
        />

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
        {status === "sleeping" && (
          <path
            d={`M ${size * 0.40} ${mouthY + size * 0.04} Q ${size * 0.5} ${mouthY + size * 0.08} ${size * 0.60} ${mouthY + size * 0.04}`}
            stroke="#A8D5BA"
            strokeWidth={size * 0.025}
            strokeLinecap="round"
            fill="none"
            opacity={0.6}
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

        {/* Zzz indicator for sleeping */}
        {status === "sleeping" && (
          <g opacity={0.4}>
            <text
              x={size * 0.72}
              y={size * 0.28}
              fontSize={size * 0.13}
              fontFamily="Jost, sans-serif"
              fontStyle="italic"
              fill="#A8D5BA"
              style={{ animation: "sleeping-z 3s ease-in-out infinite" }}
            >
              z
            </text>
            <text
              x={size * 0.80}
              y={size * 0.18}
              fontSize={size * 0.10}
              fontFamily="Jost, sans-serif"
              fontStyle="italic"
              fill="#A8D5BA"
              style={{ animation: "sleeping-z 3s ease-in-out 0.5s infinite" }}
            >
              z
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}
