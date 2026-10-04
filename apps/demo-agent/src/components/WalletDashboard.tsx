export interface Packet {
  id: string;
  dir: "left" | "right";
  color: string;
}

interface Props {
  balanceSats: number;
  spentSats: number;
  startingBalanceSats: number;
  windowSpentSats: number;
  windowMaxSats: number;
  windowSeconds: number;
  packets: Packet[];
  pulse: boolean;
}

const RADIUS = 62;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const SEGMENT_COUNT = 28;

export function SettlementConsole({
  balanceSats,
  spentSats,
  startingBalanceSats,
  windowSpentSats,
  windowMaxSats,
  windowSeconds,
  packets,
  pulse,
}: Props) {
  const spentRatio = Math.max(0, Math.min(1, spentSats / startingBalanceSats));
  const windowRatio = Math.max(0, Math.min(1, windowSpentSats / windowMaxSats));
  const filledSegments = Math.round(windowRatio * SEGMENT_COUNT);

  return (
    <div className="border-y border-white/[0.08] py-5">
      <div className="flex justify-between items-baseline mb-3.5 flex-wrap gap-2">
        <span className="font-mono text-[10.5px] tracking-[0.08em] text-slate-500 uppercase">
          Settlement console
        </span>
        <span className="font-mono text-xs text-slate-400">
          balance <span className="text-slate-50 font-semibold">{balanceSats.toLocaleString()} sats</span>
          {" · "}
          spent <span className="text-emerald-400 font-semibold">{spentSats.toLocaleString()} sats</span>
        </span>
      </div>

      <div className="relative h-[150px] sm:h-[170px]">
        <div
          className="absolute left-[14%] top-1/2 w-[24%] h-[3px] -translate-y-1/2 animate-[dashFlow_1s_linear_infinite]"
          style={{
            backgroundImage: "repeating-linear-gradient(90deg, rgba(56,189,248,.55) 0 8px, transparent 8px 16px)",
            backgroundSize: "32px 3px",
          }}
        />
        <div
          className="absolute right-[14%] top-1/2 w-[24%] h-[3px] -translate-y-1/2 animate-[dashFlow_1s_linear_infinite]"
          style={{
            backgroundImage: "repeating-linear-gradient(90deg, rgba(52,211,153,.55) 0 8px, transparent 8px 16px)",
            backgroundSize: "32px 3px",
          }}
        />

        <div className="absolute inset-0 flex justify-between items-center">
          <Node label="Agent B" ringColor="rgba(56,189,248,.4)" fillColor="rgba(56,189,248,.06)" dotColor="#38bdf8" />

          <div className="flex flex-col items-center relative">
            <svg
              width="150"
              height="150"
              viewBox="0 0 150 150"
              className="absolute -top-7 left-1/2 -translate-x-1/2"
              style={{ animation: pulse ? "ringPop .5s ease" : "none" }}
            >
              <circle cx="75" cy="75" r={RADIUS} fill="none" stroke="rgba(255,255,255,.06)" strokeWidth={6} />
              <circle
                cx="75"
                cy="75"
                r={RADIUS}
                fill="none"
                stroke="#34d399"
                strokeWidth={6}
                strokeLinecap="round"
                transform="rotate(-90 75 75)"
                style={{
                  strokeDasharray: CIRCUMFERENCE,
                  strokeDashoffset: CIRCUMFERENCE * (1 - spentRatio),
                  transition: "stroke-dashoffset .6s ease",
                }}
              />
            </svg>
            <div className="w-16 h-16 rounded-md border border-slate-50/35 bg-[#101319] flex items-center justify-center relative z-10">
              <span className="w-2 h-2 rounded-full bg-slate-50" />
            </div>
            <div className="text-xs font-semibold text-slate-50 mt-2.5">Nibi Agent</div>
          </div>

          <Node label="Insight API" ringColor="rgba(52,211,153,.4)" fillColor="rgba(52,211,153,.06)" dotColor="#34d399" />
        </div>

        {packets.map((p) => (
          <div
            key={p.id}
            className="absolute top-[calc(50%-5px)] left-1/2 w-2.5 h-2.5 rounded-full"
            style={{ background: p.color, animation: `${p.dir === "left" ? "packetLeft" : "packetRight"} .65s ease forwards` }}
          />
        ))}
      </div>

      <div className="mt-4">
        <div className="flex gap-[3px] mb-2">
          {Array.from({ length: SEGMENT_COUNT }, (_, i) => (
            <div
              key={i}
              className="flex-1 h-3.5 rounded-[1px] transition-colors duration-300"
              style={{ background: i < filledSegments ? "#f59e0b" : "rgba(255,255,255,.08)" }}
            />
          ))}
        </div>
        <div className="flex justify-between font-mono text-[11px] text-slate-500 flex-wrap gap-1">
          <span>Max 100 sats/request · auto-approve under 50 sats</span>
          <span>
            {windowSpentSats} / {windowMaxSats} sats used this {windowSeconds}s window
          </span>
        </div>
      </div>
    </div>
  );
}

function Node({
  label,
  ringColor,
  fillColor,
  dotColor,
}: {
  label: string;
  ringColor: string;
  fillColor: string;
  dotColor: string;
}) {
  return (
    <div className="w-[100px] sm:w-[120px] text-center">
      <div
        className="w-[46px] h-[46px] rounded-md mx-auto mb-2.5 flex items-center justify-center"
        style={{ border: `1px solid ${ringColor}`, background: fillColor }}
      >
        <span className="w-[7px] h-[7px] rounded-full" style={{ background: dotColor }} />
      </div>
      <div className="text-[11.5px] text-slate-300">{label}</div>
    </div>
  );
}
