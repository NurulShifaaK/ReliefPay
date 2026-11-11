import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { money } from "../lib/api";

const dayLabel = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("en-US", { weekday: "short" });
const shortDate = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** Paired columns (money in vs out), styled like the reference "Overview" chart. */
export function FlowChart({ data = [], height = 190, labels = "weekday" }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(1, ...data.flatMap((d) => [d.in, d.out]));
  return (
    <div>
      <div className="flex items-stretch gap-2" style={{ height }}>
        {data.map((d, i) => (
          <div key={d.date} className="relative flex flex-1 flex-col items-center justify-end gap-1"
               onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <AnimatePresence>
              {hover === i && (
                <motion.div
                  initial={{ opacity: 0, y: 6, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 4 }}
                  className="absolute -top-14 z-10 whitespace-nowrap rounded-2xl bg-white px-3 py-2 text-xs shadow-[var(--shadow-lift)]"
                >
                  <div className="font-bold text-navy-900">{shortDate(d.date)}</div>
                  <div className="text-leaf-500">In {money(d.in)}</div>
                  <div className="text-brand-600">Out {money(d.out)}</div>
                </motion.div>
              )}
            </AnimatePresence>
            <div className="flex h-full w-full items-end justify-center gap-1">
              {[["in", "bg-leaf-500"], ["out", "bg-brand-600"]].map(([k, cls], j) => (
                <motion.div
                  key={k}
                  className={`w-full max-w-5 rounded-t-xl rounded-b-md ${cls} ${hover !== null && hover !== i ? "opacity-40" : ""} transition-opacity`}
                  initial={{ height: 0 }}
                  animate={{ height: `${Math.max(3, (d[k] / max) * 100)}%` }}
                  transition={{ delay: i * 0.05 + j * 0.08, type: "spring", stiffness: 120, damping: 18 }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        {data.map((d) => (
          <div key={d.date} className="flex-1 text-center text-[11px] font-medium text-slate-400">
            {labels === "weekday" ? dayLabel(d.date) : shortDate(d.date).split(" ")[1]}
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-4 text-xs font-medium text-slate-500">
        <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-leaf-500" /> Donations in</span>
        <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-brand-600" /> Aid sent</span>
      </div>
    </div>
  );
}

/** Rounded pill columns with % labels, like the reference card. */
export function PillBars({ items, height = 150 }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  const colors = ["bg-white ring-1 ring-slate-200", "bg-leaf-500", "bg-white ring-1 ring-slate-200", "bg-brand-600", "bg-sun-400"];
  return (
    <div className="flex items-end gap-3" style={{ height }}>
      {items.map((it, i) => (
        <div key={it.label} className="flex flex-1 flex-col items-center gap-2">
          <motion.div
            className={`relative flex w-full items-end justify-center rounded-2xl pb-2 ${colors[i % colors.length]}`}
            initial={{ height: 0 }}
            animate={{ height: `${Math.max(18, (it.value / max) * (height - 26))}px` }}
            transition={{ delay: i * 0.08, type: "spring", stiffness: 110, damping: 16 }}
          >
            <span className={`text-[11px] font-bold ${i % 2 ? "text-white" : "text-navy-900"}`}>{it.display ?? it.value}</span>
          </motion.div>
          <span className="max-w-full truncate text-[11px] font-medium text-slate-500">{it.label}</span>
        </div>
      ))}
    </div>
  );
}

export function MiniBars({ values = [] }) {
  const max = Math.max(1, ...values);
  const palette = ["bg-sun-400", "bg-brand-600", "bg-leaf-500", "bg-navy-900"];
  return (
    <div className="flex h-12 items-end gap-1.5">
      {values.map((v, i) => (
        <motion.div key={i} className={`w-2.5 rounded-full ${palette[i % palette.length]}`}
          initial={{ height: 0 }} animate={{ height: `${Math.max(12, (v / max) * 100)}%` }}
          transition={{ delay: 0.2 + i * 0.06, type: "spring", stiffness: 140, damping: 15 }} />
      ))}
    </div>
  );
}
