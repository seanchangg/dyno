"use client";

import { useRef, useCallback } from "react";
import Card from "@/components/ui/Card";

interface InteractiveLoginCardProps {
  children: React.ReactNode;
}

const MAX_TILT = 6;

export default function InteractiveLoginCard({ children }: InteractiveLoginCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const card = cardRef.current;
    if (!card) return;

    const rect = card.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;

    const nx = dx / (rect.width / 2);
    const ny = dy / (rect.height / 2);

    const rotateY = nx * MAX_TILT;
    const rotateX = -ny * MAX_TILT;
    card.style.transform = `perspective(800px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
    card.style.transition = "transform 0.1s ease-out";
  }, []);

  const onMouseEnter = useCallback(() => {
    const card = cardRef.current;
    if (card) {
      card.style.transition = "transform 0.1s ease-out";
    }
  }, []);

  const onMouseLeave = useCallback(() => {
    const card = cardRef.current;
    if (card) {
      card.style.transform = "perspective(800px) rotateX(0deg) rotateY(0deg)";
      card.style.transition = "transform 0.4s ease-out";
    }
  }, []);

  return (
    <div
      className="relative z-20 w-full max-w-md"
      style={{ animation: "card-entrance 0.6s ease-out both" }}
    >
      <Card
        ref={cardRef}
        className="w-full max-w-md relative border-2 border-primary"
        onMouseMove={onMouseMove}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        style={{ willChange: "transform" }}
      >
        {children}
      </Card>
    </div>
  );
}
