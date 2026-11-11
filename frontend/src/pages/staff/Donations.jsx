import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Card, Page, Skeleton, StatusBadge, useToast } from "../../components/ui";
import { api, money, timeAgo } from "../../lib/api";

export default function Donations() {
  const [rows, setRows] = useState(null);
  const [monthly, setMonthly] = useState(0);
  const toast = useToast();
  useEffect(() => {
    api("/api/staff/donations").then((r) => { setRows(r.rows); setMonthly(r.activeMonthly); }).catch((e) => toast(e.message, "error"));
  }, []); // eslint-disable-line

  const total = rows?.filter((r) => r.status === "COMPLETED").reduce((s, r) => s + r.amount, 0) || 0;

  return (
    <Page>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-400">Dashboard › Donations</p>
          <h1 className="text-2xl font-extrabold tracking-tight text-navy-900 md:text-3xl">Donations</h1>
        </div>
        <div className="flex gap-2">
          <span className="rounded-full bg-brand-100 px-4 py-2 text-sm font-bold text-brand-600">↻ {monthly} monthly donors</span>
          <span className="rounded-full bg-white px-4 py-2 text-sm font-bold text-navy-900 shadow-[var(--shadow-card)]">{money(total, 2)} completed</span>
        </div>
      </div>
      <Card initial="hidden" animate="show" className="overflow-x-auto p-0">
        {!rows ? <div className="space-y-2 p-5">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10" />)}</div> : (
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-400">
              <tr>{["Donor", "Given", "USD", "Status", "Receipt", "When"].map((h) => <th key={h} className="px-5 py-4 font-semibold">{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <motion.tr key={r.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i, 20) * 0.02 }}
                  className="border-t border-slate-100 hover:bg-canvas/60">
                  <td className="px-5 py-3 font-semibold text-navy-900">
                    {r.displayName || r.donor || "Anonymous"}
                    {r.public && <span className="ml-1 rounded-full bg-sun-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">WALL</span>}
                    {r.monthly && <span className="ml-1 rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-bold text-brand-600">MONTHLY</span>}
                    {r.isSeed && <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-400">DEMO</span>}
                  </td>
                  <td className="px-5 py-3 font-bold text-navy-900">{r.display} <span className="text-xs font-medium text-slate-400">{r.currency}</span></td>
                  <td className="px-5 py-3 text-slate-600">{money(r.amount, 2)}</td>
                  <td className="px-5 py-3"><StatusBadge status={r.status} /></td>
                  <td className="px-5 py-3 font-mono text-xs text-slate-500">{r.receipt || "–"}</td>
                  <td className="px-5 py-3 text-slate-500">{timeAgo(r.at)}</td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
