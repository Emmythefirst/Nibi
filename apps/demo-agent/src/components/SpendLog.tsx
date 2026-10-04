export interface LogEntry {
  id: string;
  label: string;
  detail: string;
  tone: "success" | "blocked" | "pending" | "attack";
  at: number;
}

const toneDot: Record<LogEntry["tone"], string> = {
  success: "#34d399",
  blocked: "#f59e0b",
  pending: "#64748b",
  attack: "#fb7185",
};

const toneLabel: Record<LogEntry["tone"], string> = {
  success: "#a7f3d0",
  blocked: "#fde68a",
  pending: "#cbd5e1",
  attack: "#fecdd3",
};

export function SpendLog({ entries }: { entries: LogEntry[] }) {
  if (entries.length === 0) {
    return <div className="text-[13px] text-slate-500">No activity yet — make a paid request to get started.</div>;
  }

  return (
    // Capped height + scroll: an earlier version let this grow unbounded,
    // which visibly pushed the rest of the page down after ~10 clicks.
    <div className="max-h-[230px] overflow-y-auto flex flex-col">
      {entries.map((entry) => (
        <div key={entry.id} className="flex items-baseline gap-[9px] py-2 px-0.5 border-b border-white/[0.05]">
          <span className="w-[5px] h-[5px] mt-0.5 flex-none" style={{ background: toneDot[entry.tone] }} />
          <div className="min-w-0">
            <span className="text-[12.5px] font-semibold" style={{ color: toneLabel[entry.tone] }}>
              {entry.label}
            </span>
            <span className="text-xs text-slate-500 font-mono ml-2">{entry.detail}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
