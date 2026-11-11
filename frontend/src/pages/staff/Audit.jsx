import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Link2, ScrollText, ShieldAlert, ShieldCheck } from "lucide-react";
import { Card, EmptyState, Page, Skeleton, useToast } from "../../components/ui";
import { api } from "../../lib/api";

const COLORS = {
  login: "bg-brand-100 text-brand-600", login_failed: "bg-coral-100 text-coral-500",
  application_approved: "bg-leaf-100 text-leaf-500", application_rejected: "bg-slate-100 text-slate-500",
  agent_plan: "bg-sun-100 text-amber-700", agent_clarify: "bg-sun-100 text-amber-700", marked_fraud: "bg-coral-500 text-white", unmarked_fraud: "bg-slate-100 text-slate-600",
  payout_sent_single: "bg-navy-900 text-white", photo_analysed: "bg-brand-100 text-brand-600", login_demo: "bg-sun-100 text-amber-700", ai_report: "bg-brand-100 text-brand-600", payout_sent: "bg-navy-900 text-white", payout_failed: "bg-coral-100 text-coral-500",
};

export default function Audit() {
  const [rows, setRows] = useState(null);
  const [chain, setChain] = useState(null);
  const toast = useToast();
  useEffect(() => {
    api("/api/staff/audit").then(setRows).catch((e) => toast(e.message, "error"));
    api("/api/staff/audit/verify").then(setChain).catch(() => {});
  }, []); // eslint-disable-line

  return (
    <Page>
      <div className="mb-5">
        <p className="text-sm font-medium text-slate-400">Dashboard › Audit log</p>
        <h1 className="text-2xl font-extrabold tracking-tight text-navy-900 md:text-3xl">Who did what, and when</h1>
      </div>
      {chain && (
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
          className={`mb-4 flex items-center gap-3 rounded-[24px] p-4 ${chain.ok ? "bg-leaf-100 text-leaf-500" : "bg-coral-100 text-coral-500"}`}>
          {chain.ok ? <ShieldCheck className="h-6 w-6" /> : <ShieldAlert className="h-6 w-6" />}
          <div className="text-sm">
            <p className="font-bold">{chain.ok ? "Tamper-proof chain verified" : `Chain broken at entry #${chain.brokenAt}`}</p>
            <p className="text-navy-900/70">{chain.ok
              ? `All ${chain.checked} entries are linked by SHA-256 hashes. Editing or deleting any entry would break the chain.`
              : "Someone changed or deleted history after it was written."}</p>
          </div>
        </motion.div>
      )}
      <Card initial="hidden" animate="show">
        {!rows ? <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</div> :
          rows.length === 0 ? <EmptyState icon={ScrollText} title="Nothing logged yet" /> : (
            <ol className="relative space-y-4 border-l-2 border-slate-100 pl-6">
              {rows.map((r, i) => (
                <motion.li key={r.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i, 20) * 0.025 }} className="relative">
                  <span className="absolute -left-[31px] top-1.5 h-3 w-3 rounded-full border-2 border-white bg-navy-900" />
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${COLORS[r.action] || "bg-slate-100 text-slate-600"}`}>{r.action.replace(/_/g, " ")}</span>
                    <span className="font-semibold text-navy-900">{r.actor}</span>
                    {r.target && <span className="font-mono text-xs text-slate-500">{r.target}</span>}
                    {r.hash && <span className="flex items-center gap-1 font-mono text-[10px] text-slate-300"><Link2 className="h-3 w-3" />{r.hash}</span>}
                  </div>
                  <p className="mt-0.5 text-xs text-slate-400">{new Date(r.at).toLocaleString()} {r.ip && `· ${r.ip}`} {r.detail && `· ${r.detail}`}</p>
                </motion.li>
              ))}
            </ol>
          )}
      </Card>
    </Page>
  );
}
