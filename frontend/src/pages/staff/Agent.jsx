import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Bot, BrainCircuit, CheckCircle2, Filter, HelpCircle, Lock, RefreshCw, RotateCcw, Send, ShieldCheck, Sparkles, User, Wand2, Wrench,
} from "lucide-react";
import { Button, Card, Confetti, EmptyState, Modal, Page, RiskBadge, StatusBadge, SuccessCheck, rise, stagger, useToast } from "../../components/ui";
import { useStaff } from "../../components/layouts";
import { api, money, timeAgo } from "../../lib/api";

const EXAMPLES = [
  "Pay all approved families with urgency above 70, max $250 each",
  "Send aid to approved families in Guiuan, total under $600",
  "Pay everyone approved, up to $150 per family, include flagged cases",
];

const TOOL_LABEL = { get_funds: "Checking funds", list_towns: "Listing towns", list_approved_families: "Looking up families" };

export default function Agent() {
  const user = useStaff();
  const [input, setInput] = useState("");
  const [thread, setThread] = useState([]); // {role:"user"|"agent", text, result?}
  const [thinking, setThinking] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [batches, setBatches] = useState(null);
  const toast = useToast();
  const bottom = useRef(null);

  const loadBatches = () => api("/api/staff/payouts").then(setBatches).catch((e) => toast(e.message, "error"));
  useEffect(() => { loadBatches(); }, []); // eslint-disable-line
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [thread, thinking]);

  const ask = async (text = input) => {
    const msg = text.trim();
    if (msg.length < 2 || thinking) return;
    const history = thread.map((t) => ({ role: t.role, text: t.text })).slice(-8);
    setThread((x) => [...x, { role: "user", text: msg }]);
    setInput(""); setThinking(true); setResult(null);
    try {
      const r = await api("/api/staff/agent/plan", { method: "POST", body: { instruction: msg, history } });
      setThread((x) => [...x, {
        role: "agent", result: r,
        text: r.kind === "clarify" ? r.question : (r.filters.explanation || `Plan: ${r.items.length} families, $${r.total_usd}`),
      }]);
    } catch (e) {
      toast(e.message, "error");
      setThread((x) => x.slice(0, -1));
      setInput(msg);
    } finally { setThinking(false); }
  };

  const execute = async () => {
    setSending(true);
    try {
      const r = await api("/api/staff/agent/execute", { method: "POST", body: { token: confirm.token } });
      setResult(r); setConfirm(null); setThread([]); loadBatches();
    } catch (e) { toast(e.message, "error"); setConfirm(null); } finally { setSending(false); }
  };

  const sync = async (id) => {
    try { await api(`/api/staff/payouts/${id}/sync`, { method: "POST" }); toast("Status updated from PayPal"); loadBatches(); }
    catch (e) { toast(e.message, "error"); }
  };

  const lastAgentIdx = thread.map((t) => t.role).lastIndexOf("agent");

  return (
    <Page>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-400">Dashboard › Payout Agent</p>
          <h1 className="text-2xl font-extrabold tracking-tight text-navy-900 md:text-3xl">Tell the agent who to pay</h1>
        </div>
        {thread.length > 0 && <Button variant="ghost" icon={RotateCcw} onClick={() => { setThread([]); setResult(null); }}>New conversation</Button>}
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          {/* Prompt box */}
          <Card initial="hidden" animate="show" className="card-wave bg-navy-900 text-white">
            <div className="flex items-center gap-3">
              <motion.span animate={{ rotate: thinking ? 360 : 0 }} transition={{ repeat: thinking ? Infinity : 0, duration: 1.6, ease: "linear" }}
                className="grid h-11 w-11 place-items-center rounded-full bg-sun-400 text-navy-900"><Bot className="h-5 w-5" /></motion.span>
              <div>
                <p className="font-bold">Payout Agent</p>
                <p className="text-xs text-white/60">It checks funds and families with its own tools, asks when something is unclear, and you approve before money moves.</p>
              </div>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); ask(); }} className="mt-5 flex gap-2 rounded-full bg-white p-1.5">
              <input value={input} onChange={(e) => setInput(e.target.value)} maxLength={500}
                className="min-w-0 flex-1 rounded-full bg-transparent px-4 text-sm text-navy-900 outline-none"
                placeholder={thread.length ? "Reply to the agent…" : "e.g. Pay approved families with urgency above 70, max $200 each"} />
              <Button type="submit" variant="sun" icon={thread.length ? Send : Wand2} loading={thinking}>{thread.length ? "Reply" : "Plan"}</Button>
            </form>
            {!thread.length && (
              <div className="mt-3 flex flex-wrap gap-2">
                {EXAMPLES.map((ex) => (
                  <motion.button key={ex} whileHover={{ y: -2 }} onClick={() => ask(ex)}
                    className="rounded-full bg-white/10 px-3 py-1.5 text-left text-xs text-white/90 hover:bg-white/20">{ex}</motion.button>
                ))}
              </div>
            )}
          </Card>

          {result && (
            <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
              className="relative grid place-items-center rounded-[28px] bg-white p-8 text-center shadow-[var(--shadow-card)]">
              <Confetti fire />
              <SuccessCheck size={80} />
              <p className="mt-4 text-2xl font-extrabold text-navy-900">{money(result.totalUsd)} sent to {result.families} families</p>
              <p className="mt-1 text-sm text-slate-500">PayPal batch <span className="font-mono">{result.paypalBatchId}</span> · status {result.status}</p>
            </motion.div>
          )}

          {/* Conversation */}
          <div className="space-y-4">
            {thread.map((m, i) => m.role === "user" ? (
              <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex justify-end gap-2">
                <p className="max-w-[80%] rounded-[22px] rounded-br-md bg-brand-600 px-4 py-3 text-sm text-white">{m.text}</p>
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-sun-400 text-navy-900"><User className="h-4 w-4" /></span>
              </motion.div>
            ) : (
              <AgentTurn key={i} r={m.result} active={i === lastAgentIdx} onSend={(plan) => setConfirm(plan)} />
            ))}
            {thinking && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-3 rounded-[28px] bg-white p-5 shadow-[var(--shadow-card)]">
                <BrainCircuit className="h-5 w-5 animate-pulse text-brand-600" />
                <span className="text-sm font-medium text-slate-600">Using tools: checking funds, approvals and fraud flags…</span>
              </motion.div>
            )}
            <div ref={bottom} />
          </div>
        </div>

        {/* Batches */}
        <Card initial="hidden" animate="show" className="h-fit">
          <h2 className="text-lg font-bold text-navy-900">Payout batches</h2>
          <div className="mt-4 space-y-3">
            {!batches ? <p className="text-sm text-slate-400">Loading…</p> : batches.length === 0 ? <p className="text-sm text-slate-500">No batches yet.</p> :
              batches.map((b) => (
                <motion.details key={b.id} layout className="group rounded-3xl bg-canvas p-4">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-extrabold text-navy-900">{money(b.totalUsd)} · {b.items.length} families</p>
                      <p className="text-xs text-slate-500">{b.createdBy} · {timeAgo(b.createdAt)}</p>
                    </div>
                    <StatusBadge status={b.status} />
                  </summary>
                  <p className="mt-3 text-xs italic text-slate-500">"{b.instruction}"</p>
                  <ul className="mt-3 space-y-1.5">
                    {b.items.map((it) => (
                      <li key={it.ref} className="flex items-center justify-between gap-2 text-xs">
                        <span className="truncate text-navy-900">{it.name}</span>
                        <span className="flex items-center gap-2"><span className="font-bold">{money(it.amount)}</span><StatusBadge status={it.status} /></span>
                      </li>
                    ))}
                  </ul>
                  {b.paypalBatchId && !b.paypalBatchId.startsWith("SEED") && (
                    <button onClick={() => sync(b.id)} className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-brand-600"><RefreshCw className="h-3.5 w-3.5" /> Refresh from PayPal</button>
                  )}
                </motion.details>
              ))}
          </div>
        </Card>
      </div>

      <Modal open={!!confirm} onClose={() => !sending && setConfirm(null)}>
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-brand-100 text-brand-600"><ShieldCheck className="h-6 w-6" /></span>
          <div>
            <h3 className="text-lg font-extrabold text-navy-900">Confirm payout</h3>
            <p className="text-sm text-slate-500">Signed in as {user.name} ({user.role})</p>
          </div>
        </div>
        <p className="mt-5 text-slate-700">
          Send <b>{money(confirm?.total_usd, 2)}</b> to <b>{confirm?.items.length}</b> families with PayPal Payouts? This can't be undone.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirm(null)} disabled={sending}>Cancel</Button>
          <Button variant="blue" icon={Send} loading={sending} onClick={execute}>Yes, send now</Button>
        </div>
      </Modal>
    </Page>
  );
}

function Steps({ steps }) {
  if (!steps?.length) return null;
  return (
    <ol className="mt-3 space-y-1.5">
      {steps.map((s, i) => (
        <motion.li key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.18 }}
          className="flex items-center gap-2 text-xs text-slate-600">
          <span className="grid h-6 w-6 place-items-center rounded-full bg-brand-50 text-brand-600"><Wrench className="h-3 w-3" /></span>
          <span className="font-semibold text-navy-900">{TOOL_LABEL[s.tool] || s.tool}</span>
          <span className="truncate">· {s.summary}</span>
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-leaf-500" />
        </motion.li>
      ))}
    </ol>
  );
}

function AgentTurn({ r, active, onSend }) {
  if (r.kind === "clarify") {
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex gap-2">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-navy-900 text-sun-400"><Bot className="h-4 w-4" /></span>
        <div className="max-w-[85%] rounded-[22px] rounded-tl-md bg-white p-4 shadow-[var(--shadow-card)]">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-xs font-bold text-amber-700"><HelpCircle className="h-4 w-4" /> The agent has a question</span>
            <span className="text-[10px] font-semibold text-slate-400">{r.provider}</span>
          </div>
          <Steps steps={r.steps} />
          <p className="mt-3 text-sm font-semibold text-navy-900">{r.question}</p>
        </div>
      </motion.div>
    );
  }
  const fl = r.filters;
  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="flex gap-2">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-navy-900 text-sun-400"><Bot className="h-4 w-4" /></span>
      <div className="min-w-0 flex-1 space-y-3">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-base font-bold text-navy-900"><Sparkles className="h-5 w-5 text-sun-400" /> What I checked and understood</h2>
            <span className="rounded-full bg-canvas px-3 py-1 text-xs font-semibold text-slate-500">{r.provider}</span>
          </div>
          <Steps steps={r.steps} />
          {fl.explanation && <p className="mt-3 text-sm text-slate-600">{fl.explanation}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {[
              fl.min_urgency != null && `Urgency ≥ ${fl.min_urgency}`,
              fl.locations && `Towns: ${fl.locations.join(", ")}`,
              `Max ${money(r.per_family_cap_usd)} / family`,
              `Budget ${money(r.budget_usd)}`,
              fl.include_medium_risk ? "Including medium-risk" : "Low risk only",
              "Approved only", "High risk always excluded",
            ].filter(Boolean).map((c, i) => (
              <motion.span key={c} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.3 + i * 0.05 }}
                className="flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-600"><Filter className="h-3 w-3" />{c}</motion.span>
            ))}
          </div>
        </Card>
        <Card>
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-navy-900">Payout plan · {r.items.length} families</h2>
            <p className="text-2xl font-extrabold text-navy-900">{money(r.total_usd, 2)}</p>
          </div>
          {r.items.length ? (
            <motion.ul variants={stagger} initial="hidden" animate="show" className="mt-3 divide-y divide-slate-100">
              {r.items.map((it) => (
                <motion.li key={it.application_id} variants={rise} className="flex items-center gap-3 py-3">
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-canvas text-sm font-extrabold text-navy-900">{it.urgency}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-navy-900">{it.name} <span className="font-mono text-xs font-medium text-slate-400">{it.ref}</span></p>
                    <p className="truncate text-xs text-slate-500">{it.location} · <span className="capitalize">{it.need || "other"}</span> · {it.method === "VENMO" ? `Venmo ${it.receiver}` : it.receiver}</p>
                  </div>
                  <RiskBadge risk={it.risk} />
                  <span className="w-20 text-right font-extrabold text-navy-900">{money(it.amount_usd)}</span>
                </motion.li>
              ))}
            </motion.ul>
          ) : <div className="mt-3"><EmptyState icon={Filter} title="No families match" text="Approve more requests or loosen the instruction." /></div>}
          {r.skipped.length > 0 && (
            <p className="mt-3 rounded-2xl bg-canvas p-3 text-xs text-slate-500">Skipped: {r.skipped.map((s) => `${s.ref} (${s.reason})`).join(", ")}</p>
          )}
          {active && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="flex items-center gap-1.5 text-xs text-slate-400"><Lock className="h-3.5 w-3.5" /> Plan expires in 10 minutes and can be used once.</p>
              {r.canExecute ? (
                <Button variant="blue" icon={Send} disabled={!r.items.length || !r.paypalReady} onClick={() => onSend(r)}>Send with PayPal</Button>
              ) : <span className="rounded-full bg-sun-100 px-4 py-2 text-xs font-semibold text-amber-700">Only an admin can send money</span>}
            </div>
          )}
        </Card>
      </div>
    </motion.div>
  );
}
