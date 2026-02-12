"use client";

import React, { useEffect, useState, useCallback } from "react";
import Card from "@/components/ui/Card";
import { useAgentStatus } from "@/hooks/useAgentStatus";
import { useAuth } from "@/hooks/useAuth";
import {
  fetchTokenUsageTotals,
  type TokenUsageTotals,
} from "@/lib/token-usage";

const REFRESH_INTERVAL = 5000;

type DataSource = "agent-status" | "sessions" | "token-usage" | "cost";

interface StatCardWidgetProps {
  title?: string;
  dataSource?: DataSource;
}

function StatCardWidget({ title, dataSource }: StatCardWidgetProps) {
  const { status } = useAgentStatus();
  const { user } = useAuth();
  const [totals, setTotals] = useState<TokenUsageTotals>({
    totalTokensIn: 0,
    totalTokensOut: 0,
    sessionCount: 0,
  });

  const refresh = useCallback(async () => {
    if (!user) return;
    const t = await fetchTokenUsageTotals(user.id);
    setTotals(t);
  }, [user]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, REFRESH_INTERVAL);
    return () => clearInterval(id);
  }, [refresh]);

  let displayValue: React.ReactNode = "—";

  switch (dataSource) {
    case "agent-status":
      displayValue = (
        <span className="capitalize">{status}</span>
      );
      break;
    case "sessions":
      displayValue = totals.sessionCount;
      break;
    case "token-usage":
      displayValue = `${totals.totalTokensIn.toLocaleString()} / ${totals.totalTokensOut.toLocaleString()}`;
      break;
    case "cost":
      displayValue = `$${(
        totals.totalTokensIn * 0.000003 +
        totals.totalTokensOut * 0.000015
      ).toFixed(6)}`;
      break;
  }

  return (
    <Card className="h-full flex flex-col justify-center">
      <h3 className="text-xs font-medium text-text/50 mb-1">
        {title || dataSource || "Stat"}
      </h3>
      <p className="text-lg font-semibold text-highlight">
        {displayValue}
      </p>
    </Card>
  );
}

export default React.memo(StatCardWidget);
