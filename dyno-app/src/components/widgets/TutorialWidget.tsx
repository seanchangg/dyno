"use client";

import React, { useState } from "react";

const EXAMPLE_PROMPTS = [
  {
    category: "Build",
    prompts: [
      "Create a music widget that lets me search for and play music using Youtube iFrame API and scraping",
      "Build me a pomodoro timer widget with start/pause/reset and a log of completed sessions",
      "Make a weather dashboard widget that shows the forecast for my city",
    ],
  },
  {
    category: "Automate",
    prompts: [
      "Spawn a child agent that just tells me jokes nonstop",
      "Take a screenshot of https://news.ycombinator.com and save it",
      "Build a graph from the latest tech news headlines",
      "Interview me and record my profile in memories",
    ],
  },
  {
    category: "Configure",
    prompts: [
      "What skills do you have installed? What new ones would you suggest?",
      "Rearrange my dashboard — put chat on the left, stats on the right, and make everything bigger",
      "Save a memory that I prefer dark, minimal UI and concise responses",
    ],
  },
];

function TutorialWidget() {
  const [copied, setCopied] = useState<string | null>(null);

  const handleCopy = async (prompt: string) => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(prompt);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // Fallback for clipboard API failure
    }
  };

  let globalIndex = 0;

  return (
    <div className="h-full overflow-y-auto bg-surface border border-primary/20 p-4">
      <h2 className="text-base font-semibold text-highlight mb-1">
        Getting Started
      </h2>
      <p className="text-xs text-text/40 mb-4">
        Click any prompt to copy it, then paste into the Agent Chat.
      </p>

      {EXAMPLE_PROMPTS.map((group) => (
        <div key={group.category} className="mb-4">
          <h3 className="text-[10px] uppercase tracking-wider text-text/30 mb-2">
            {group.category}
          </h3>
          <div className="flex flex-col gap-1.5">
            {group.prompts.map((prompt) => {
              const isCopied = copied === prompt;
              const delay = globalIndex * 0.06;
              globalIndex++;
              return (
                <button
                  key={prompt}
                  onClick={() => handleCopy(prompt)}
                  className="text-left px-3 py-2 text-xs text-text/70 bg-background border border-primary/15 hover:border-primary/40 hover:text-highlight transition-colors cursor-pointer"
                  style={{ animation: `prompt-enter 0.35s ease-out ${delay}s both` }}
                >
                  <span className={isCopied ? "text-highlight" : ""}>
                    {isCopied ? "Copied!" : prompt}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <p className="text-[10px] text-text/25 mt-2">
        Marty can build widgets, take screenshots, search the web, manage files,
        run code, and more. Just ask.
      </p>
    </div>
  );
}

export default React.memo(TutorialWidget);
