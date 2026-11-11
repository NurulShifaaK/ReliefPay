import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, Bot, BrainCircuit, CheckCircle2, CreditCard, ShieldAlert, Users, XCircle } from "lucide-react";
import { AnimatedNumber, Card, Page, RiskBadge, Skeleton, UrgencyRing, rise, stagger, useToast } from "../../components/ui";
import { FlowChart, MiniBars } from "../../components/charts";
import { CardStack, HeroCards } from "../../components/brand";
import { useStaff } from "../../components/layouts";
import { api, money, timeAgo } from "../../lib/api";
import { SituationReport, StaffMap } from "../../components/staffWidgets";

const ACTION_TEXT = {
  login: "signed in", application_approved: "approved", application_rejected: "rejected",
  agent_plan: "drafted a payout plan", payout_sent: "sent a payout batch", payout_failed: "payout failed",
  agent_clarify: "was asked a question by the agent", ai_report: "generated an AI report",
  login_demo: "signed in as a judge", photo_analysed: "analysed a photo", marked_fraud: "marked as fraud",
  unmarked_fraud: "removed a fraud mark", payout_sent_single: "paid a family",
};

export default function Dashboard() {
  const [d, setD] = useState(null);
  const [params, setParams] = useSearchParams();
  const [tour, setTour] = useState(() => {
    try { return params.get("tour") === "1" || localStorage.getItem("rp-tour") === "open"; } catch { return params.get("tour") === "1"; }
  });
  const closeTour = () => {
    setTour(false);
    try { localStorage.removeItem("rp-tour"); } catch { /* ignore */ }
    if (params.get("tour")) setParams({}, { replace: true });
  };
  useEffect(() => { if (tour) { try { localStorage.setItem("rp-tour", "open"); } catch { /* ignore */ } } }, [tour]);
  const user = useStaff();
  const toast = useToast();
  useEffect(() => { api("/api/staff/dashboard").then(setD).catch((e) => toast(e.message, "error")); }, []); // eslint-disable-line

  if (!d) return <Page className="grid gap-5 xl:grid-cols-[1fr_340px]"><div className="grid gap-5 md:grid-cols-2"><Skeleton className="h-56" /><Skeleton className="h-56" /><Skeleton className="h-64 md:col-span-2" /></div><Skeleton className="h-[520px]" /></Page>;

  const f = d.funds;
  const weekIn = d.series.map((s) => s.in);

  return (
    <Page>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-400">Dashboard › Typhoon response</p>
          <h1 className="text-2xl font-extrabold tracking-tight text-navy-900 md:text-3xl">Good to see you, {user.name.split(" ")[0]}</h1>
        </div>
        <div className="flex gap-2 text-xs font-semibold">
          <span className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 ${d.aiMode === "heuristic" ? "bg-sun-100 text-amber-700" : "bg-leaf-100 text-leaf-500"}`}>
            <BrainCircuit className="h-3.5 w-3.5" /> AI: {d.aiMode === "heuristic" ? "offline rules" : d.aiMode}
          </span>
          {d.aiError && d.aiMode !== "heuristic" && (
            <span title={d.aiError} className="flex items-center gap-1.5 rounded-full bg-coral-100 px-3 py-1.5 text-coral-500">AI problem: {d.aiError.slice(0, 46)}{d.aiError.length > 46 ? "…" : ""}</span>
          )}
          <span className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 ${d.paypalReady ? "bg-leaf-100 text-leaf-500" : "bg-coral-100 text-coral-500"}`}>
            <CreditCard className="h-3.5 w-3.5" /> PayPal {d.paypalReady ? "sandbox connected" : "not configured"}
          </span>
        </div>
      </div>

      {tour && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="card-wave mb-5 rounded-[28px] bg-sun-400 p-5 text-navy-900 shadow-[var(--shadow-card)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-lg font-extrabold">Welcome, judge 👋 Here is the 2-minute tour</p>
              <p className="text-sm font-medium text-navy-900/70">You are signed in as a reviewer on demo data. Nothing you do moves real money.</p>
            </div>
            <button onClick={closeTour} className="rounded-full bg-navy-900/10 px-3 py-1.5 text-xs font-bold hover:bg-navy-900/20">Hide tour</button>
          </div>
          <ol className="mt-4 grid gap-2 md:grid-cols-5">
            {[
              ["See fraud caught", "Open Mark Tan: same photo, phone and story as another request.", "/staff/applications?risk=high"],
              ["Photo evidence", "Open any request, then “View & analyse photo” for AI labels.", "/staff/applications?status=APPROVED"],
              ["Disaster check", "Vikram Sethi claims a flood where none was reported.", "/staff/applications?status=PENDING"],
              ["Payout Agent", "Type who to pay in plain English; it checks funds and asks questions.", "/staff/agent"],
              ["Follow the money", "Public page: receipt DN-DEMO01 shows which families it reached.", "/transparency?receipt=DN-DEMO01#follow"],
            ].map(([title, text, to], i) => (
              <Link key={title} to={to} className="rounded-2xl bg-white/70 p-3 transition hover:bg-white">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-navy-900 text-xs font-extrabold text-white">{i + 1}</span>
                <p className="mt-2 text-sm font-bold">{title}</p>
                <p className="text-xs text-navy-900/70">{text}</p>
              </Link>
            ))}
          </ol>
        </motion.div>
      )}

      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <motion.div variants={stagger} initial="hidden" animate="show" className="grid content-start gap-5 md:grid-cols-[1.3fr_1fr]">
          {/* Hero balance */}
          <Card className="relative overflow-hidden bg-gradient-to-br from-white to-brand-50">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-bold text-brand-600">Available for aid</p>
                <p className="mt-2 text-4xl font-extrabold tracking-tight text-navy-900"><AnimatedNumber value={f.availableUsd} prefix="$" /></p>
                <p className="mt-1 text-sm text-slate-500">{money(f.committedUsd)} already committed to families</p>
                <Link to="/staff/agent" className="mt-5 inline-flex items-center gap-2 rounded-full bg-navy-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-navy-800">
                  <Bot className="h-4 w-4" /> Open Payout Agent
                </Link>
              </div>
              <div className="hidden scale-75 sm:block md:scale-[0.8]"><HeroCards /></div>
            </div>
          </Card>

          {/* Raised */}
          <Card>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-navy-900">Donations</h2>
              <Link to="/staff/donations" className="text-sm font-semibold text-slate-400 hover:text-navy-900">Details ›</Link>
            </div>
            <div className="mt-3 rounded-3xl bg-canvas p-4 text-center">
              <p className="text-sm font-medium text-slate-500">Raised</p>
              <p className="text-4xl font-light tracking-tight text-navy-900"><AnimatedNumber value={f.raisedUsd} prefix="$" /></p>
              <div className="mt-3 flex items-end justify-between">
                <MiniBars values={weekIn} />
                <span className="rounded-full bg-leaf-100 px-2 py-1 text-xs font-bold text-leaf-500">{f.donors} donors</span>
              </div>
            </div>
          </Card>

          {/* Queue counters */}
          <Card>
            <h2 className="text-lg font-bold text-navy-900">Review queue</h2>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {[
                ["PENDING", "Waiting", Users, "bg-brand-100 text-brand-600"],
                ["APPROVED", "Approved", CheckCircle2, "bg-leaf-100 text-leaf-500"],
                ["PAID", "Paid", CreditCard, "bg-navy-900 text-white"],
                ["REJECTED", "Rejected", XCircle, "bg-slate-100 text-slate-500"],
              ].map(([k, label, Icon, cls]) => (
                <Link key={k} to={`/staff/applications?status=${k}`}>
                  <motion.div whileHover={{ y: -3 }} className="rounded-3xl bg-canvas p-4">
                    <span className={`grid h-9 w-9 place-items-center rounded-full ${cls}`}><Icon className="h-4 w-4" /></span>
                    <p className="mt-3 text-2xl font-extrabold text-navy-900"><AnimatedNumber value={d.counts[k]} /></p>
                    <p className="text-xs font-medium text-slate-500">{label}</p>
                  </motion.div>
                </Link>
              ))}
            </div>
            {d.highRiskPending > 0 && (
              <Link to="/staff/applications?risk=high" className="mt-3 flex items-center gap-2 rounded-2xl bg-coral-100 p-3 text-sm font-semibold text-coral-500">
                <ShieldAlert className="h-4 w-4" /> {d.highRiskPending} high-risk requests need a careful look
              </Link>
            )}
          </Card>

          {/* Overview chart */}
          <Card>
            <h2 className="text-lg font-bold text-navy-900">Overview · 7 days</h2>
            <div className="mt-5"><FlowChart data={d.series} height={170} /></div>
          </Card>

          <SituationReport />

          {/* Urgent */}
          <Card className="md:col-span-2">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-navy-900">Most urgent, waiting for review</h2>
              <Link to="/staff/applications" className="flex items-center gap-1 text-sm font-semibold text-brand-600">All <ArrowRight className="h-4 w-4" /></Link>
            </div>
            <motion.ul variants={stagger} initial="hidden" animate="show" className="mt-4 space-y-2">
              {d.urgent.map((a) => (
                <motion.li key={a.id} variants={rise}>
                  <Link to={`/staff/applications?open=${a.id}`} className="flex items-center gap-4 rounded-2xl bg-canvas p-3 transition hover:bg-brand-50">
                    <UrgencyRing score={a.ai.urgency} size={46} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-navy-900">{a.fullName} <span className="font-medium text-slate-400">· {a.location}</span></p>
                      <p className="truncate text-xs text-slate-500">{a.ai.summary || "AI review in progress…"}</p>
                    </div>
                    <RiskBadge risk={a.fraud.risk} />
                  </Link>
                </motion.li>
              ))}
              {!d.urgent.length && <p className="text-sm text-slate-500">Queue is empty. 🎉</p>}
            </motion.ul>
          </Card>

          <StaffMap />
        </motion.div>

        {/* Right column */}
        <motion.aside variants={stagger} initial="hidden" animate="show" className="space-y-5">
          <Card>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-navy-900">Funds <span className="text-sm font-semibold text-leaf-500">3</span></h2>
              <span className="text-xs font-medium text-slate-400">hover me</span>
            </div>
            <CardStack cards={[
              { theme: "sun", label: "Raised", amount: f.raisedUsd, chip: "★", footer: `${f.donors} donors` },
              { theme: "blue", label: "Committed", amount: f.committedUsd, chip: "⇢", footer: "Approved & sent" },
              { theme: "navy", label: "Available", amount: f.availableUsd, chip: "✓", footer: "Ready for the next batch" },
            ]} />
          </Card>
          <Card>
            <h2 className="text-lg font-bold text-navy-900">Activity</h2>
            <ul className="mt-3 space-y-3">
              {d.activity.map((a, i) => (
                <motion.li key={i} variants={rise} className="flex items-start gap-3">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-600" />
                  <div className="text-sm">
                    <span className="font-semibold text-navy-900">{a.actor.split("@")[0]}</span>{" "}
                    <span className="text-slate-500">{ACTION_TEXT[a.action] || a.action}</span>{" "}
                    {a.target && <span className="font-mono text-xs text-slate-400">{a.target}</span>}
                    <p className="text-xs text-slate-400">{timeAgo(a.at)}</p>
                  </div>
                </motion.li>
              ))}
              {!d.activity.length && <p className="text-sm text-slate-500">No activity yet.</p>}
            </ul>
          </Card>
        </motion.aside>
      </div>
    </Page>
  );
}
