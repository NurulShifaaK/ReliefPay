import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { BrainCircuit, Map as MapIcon, Sparkles } from "lucide-react";
import { Button, Card, useToast } from "./ui";
import ReliefMap, { urgencyColor } from "./ReliefMap";
import { api, timeAgo } from "../lib/api";

export function SituationReport() {
  const [rep, setRep] = useState(null);
  const [loading, setLoading] = useState(false);
  const toast = useToast();
  const run = async () => {
    setLoading(true);
    try { setRep(await api("/api/staff/report", { method: "POST" })); }
    catch (e) { toast(e.message, "error"); } finally { setLoading(false); }
  };
  return (
    <Card className="card-wave bg-navy-900 text-white md:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-bold"><BrainCircuit className="h-5 w-5 text-sun-400" /> AI situation report</h2>
        <Button variant="sun" icon={Sparkles} loading={loading} onClick={run}>{rep ? "Refresh" : "Generate"}</Button>
      </div>
      <AnimatePresence mode="wait">
        {rep ? (
          <motion.div key={rep.at} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <p className="mt-4 text-xl font-extrabold">{rep.headline}</p>
            <ul className="mt-3 space-y-2">
              {rep.bullets.map((b, i) => (
                <motion.li key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.08 }}
                  className="flex gap-2 text-sm text-white/90"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-sun-400" />{b}</motion.li>
              ))}
            </ul>
            {rep.recommendation && <p className="mt-4 rounded-2xl bg-white/10 p-3 text-sm"><b className="text-sun-400">Next step:</b> {rep.recommendation}</p>}
            <p className="mt-3 text-[11px] text-white/50">{rep.provider} · {timeAgo(rep.at)}</p>
          </motion.div>
        ) : (
          <p key="empty" className="mt-3 text-sm text-white/70">One click: the AI reads today's numbers and writes a briefing for the field team.</p>
        )}
      </AnimatePresence>
    </Card>
  );
}

export function StaffMap() {
  const [rows, setRows] = useState(null);
  useEffect(() => { api("/api/staff/map").then(setRows).catch(() => setRows([])); }, []);
  if (!rows?.length) return null;
  const points = rows.map((r) => ({
    key: r.id, lat: r.lat + ((r.id % 7) - 3) * 0.004, lng: r.lng + ((r.id % 5) - 2) * 0.004, // tiny offset so dots don't overlap
    color: r.risk === "high" ? "#13235b" : urgencyColor(r.urgency ?? 0), radius: r.status === "PAID" ? 7 : 10,
    title: `${r.name} · ${r.ref}`, lines: [`${r.location} · urgency ${r.urgency ?? "–"}`, `${r.status.toLowerCase()} · ${r.risk} risk`],
  }));
  return (
    <Card className="md:col-span-2">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-bold text-navy-900"><MapIcon className="h-5 w-5 text-brand-600" /> Requests map</h2>
        <div className="flex flex-wrap gap-3 text-xs font-medium text-slate-500">
          {[["#f2665a", "80+"], ["#f5a524", "55-79"], ["#3b74ff", "30-54"], ["#13235b", "high risk"]].map(([c, l]) => (
            <span key={l} className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />{l}</span>
          ))}
        </div>
      </div>
      <ReliefMap points={points} height={320} />
      <Link to="/staff/applications" className="mt-3 inline-block text-sm font-semibold text-brand-600">Open the list →</Link>
    </Card>
  );
}
