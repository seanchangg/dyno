"use client";

import React from "react";

interface TableWidgetProps {
  headers?: string[];
  rows?: string[][];
}

function TableWidget({ headers = [], rows = [] }: TableWidgetProps) {
  return (
    <div className="h-full overflow-auto bg-surface border border-primary/20">
      <div className="border-b border-primary/20 px-4 py-2">
        <h2 className="text-xs font-semibold text-highlight">Table</h2>
      </div>
      {headers.length === 0 && rows.length === 0 ? (
        <p className="text-xs text-text/30 text-center py-6">No data</p>
      ) : (
        <table className="w-full text-xs">
          {headers.length > 0 && (
            <thead>
              <tr className="border-b border-primary/20 bg-background">
                {headers.map((h, i) => (
                  <th
                    key={i}
                    className="text-left px-3 py-2 text-text/50 font-medium"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} className="border-b border-primary/10">
                {row.map((cell, ci) => (
                  <td key={ci} className="px-3 py-1.5 text-text/70">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default React.memo(TableWidget);
