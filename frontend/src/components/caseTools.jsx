// Staff tools for one application: disaster check card, photo evidence viewer, pay modal, fraud modal.
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle, BadgeCheck, Banknote, Check, CircleHelp, CloudRainWind, ExternalLink, Eye, EyeOff, Flag, Info,
  Loader2, MapPin, RefreshCw, ScanSearch, Send, ShieldAlert, Sparkles, X,
} from "lucide-react";
import { Button, Confetti, Modal, SuccessCheck, inputCls, useToast } from "./ui";
import { api, money, timeAgo } from "../lib/api";

export const NEED_LABEL = { food: "Food & water", shelter: "Shelter / repairs", medical: "Medical", education: "Education",
  livelihood: "Work / livelihood", other: "Other" };

// ---------------------------------------------------------------- Disaster check
const D_STYLE = {
  confirmed: { cls: "bg-leaf-100", tone: "text-leaf-500", icon: BadgeCheck, title: "Disaster confirmed" },
  not_found: { cls: "bg-sun-100", tone: "text-amber-700", icon: AlertTriangle, title: "Not confirmed - check before paying" },
  not_claimed: { cls: "bg-canvas", tone: "text-slate-500", icon: Info, title: "Non-disaster request" },
  unknown: { cls: "bg-canvas", tone: "text-slate-500", icon: CircleHelp, title: "Could not check the disaster" },
};

export function DisasterCard({ app, onRecheck, busy }) {
  const d = app.disaster || {};
  const st = D_STYLE[d.status] || D_STYLE.unknown;
  const c = d.check;
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={`rounded-3xl p-4 ${st.cls}`}>
      <div className="flex items-start justify-between gap-3">
        <p className={`flex items-center gap-2 text-sm font-bold ${st.tone}`}><st.icon className="h-4 w-4" /> {st.title}</p>
        <button onClick={onRecheck} disabled={busy} className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-navy-900 disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} /> Re-check
        </button>
      </div>
      {d.status === "not_claimed" && (
        <p className="mt-2 text-sm text-navy-900">The applicant did not say a disaster affected them. Need: <b>{NEED_LABEL[app.need] || "Other"}</b>. No disaster check needed.</p>
      )}
      {d.status === "unknown" && (
        <p className="mt-2 text-sm text-navy-900">The outside sources could not be reached, so nothing was flagged. Try Re-check.</p>
      )}
      {d.status === "not_found" && (
        <p className="mt-2 text-sm text-navy-900">
          The applicant describes a <b>{d.event || "disaster"}</b> in <b>{app.location}</b>, but none was found there in the last {c?.lookback_days || 30} days.
          This is a warning, not a rejection: talk to the family or ask for proof before paying.
        </p>
      )}
      {d.status === "confirmed" && c && (
        <div className="mt-2 space-y-1.5 text-sm text-navy-900">
          {c.zone?.inside && <p className="flex items-center gap-2"><MapPin className="h-4 w-4 text-leaf-500" /> Inside the active campaign area “{c.zone.name}” ({c.zone.distance_km} km from its centre).</p>}
          {c.events?.map((e, i) => (
            <p key={i} className="flex items-start gap-2"><CloudRainWind className="mt-0.5 h-4 w-4 shrink-0 text-leaf-500" />
              <span><b>{e.name}</b> · {e.date} · {e.distance_km} km away · {e.source}
                {e.url && <a href={e.url} target="_blank" rel="noopener noreferrer" className="ml-1 inline-flex items-center text-brand-600 underline">report <ExternalLink className="ml-0.5 h-3 w-3" /></a>}</span></p>
          ))}
        </div>
      )}
      {c?.web && (
        <div className="mt-3 rounded-2xl bg-white/70 p-3 text-sm text-navy-900">
          <p className="flex items-center gap-1.5 text-xs font-bold text-brand-600"><Sparkles className="h-3.5 w-3.5" /> AI web search · confidence {Math.round((c.web.confidence || 0) * 100)}%</p>
          <p className="mt-1">{c.web.summary}</p>
          {c.web.sources?.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {c.web.sources.map((s, i) => (
                <a key={i} href={s.url} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-600 hover:underline">
                  {s.title} <ExternalLink className="h-3 w-3" /></a>
              ))}
            </div>
          )}
        </div>
      )}
      {c && (
        <p className="mt-2 text-[11px] text-slate-500">
          Checked: {(c.sources_checked || []).join(", ") || "nothing"}{c.demo ? " · demo data" : ""}{c.checked_at ? ` · ${timeAgo(c.checked_at)}` : ""}
        </p>
      )}
    </motion.div>
  );
}

// ---------------------------------------------------------------- Photo evidence viewer
const KIND = {
  damage: { color: "#f2665a", label: "Damage" },
  hazard: { color: "#3b74ff", label: "Hazard" },
  context: { color: "#94a3b8", label: "Context" },
};
const AUTH = {
  real_photo: ["Looks like a real photo", "bg-leaf-100 text-leaf-500"],
  screenshot: ["Looks like a screenshot", "bg-coral-100 text-coral-500"],
  stock_or_downloaded: ["May be a stock / downloaded image", "bg-coral-100 text-coral-500"],
  ai_generated: ["May be AI-generated", "bg-coral-100 text-coral-500"],
  unclear: ["Authenticity unclear", "bg-slate-100 text-slate-600"],
};

function MatchRing({ value }) {
  const r = 30, c = 2 * Math.PI * r;
  const color = value >= 70 ? "#34a77f" : value >= 35 ? "#f5a524" : "#f2665a";
  return (
    <div className="relative h-[76px] w-[76px] shrink-0">
      <svg width="76" height="76" className="-rotate-90">
        <circle cx="38" cy="38" r={r} stroke="rgba(255,255,255,0.15)" strokeWidth="6" fill="none" />
        <motion.circle cx="38" cy="38" r={r} stroke={color} strokeWidth="6" fill="none" strokeLinecap="round" strokeDasharray={c}
          initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c - (c * value) / 100 }} transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }} />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-lg font-extrabold text-white">{value}</span>
    </div>
  );
}

export function PhotoViewer({ app, open, onClose, onChanged }) {
  const [res, setRes] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [labels, setLabels] = useState(true);
  const [hover, setHover] = useState(null);
  const [ratio, setRatio] = useState(4 / 3);

  useEffect(() => {
    if (open) { setRes(app?.photoAnalysis || null); setErr(""); setHover(null); setLabels(true); }
  }, [open, app?.id]); // eslint-disable-line

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const analyse = async (force) => {
    setLoading(true); setErr("");
    try {
      setRes(await api(`/api/staff/applications/${app.id}/analyze-photo${force ? "?force=true" : ""}`, { method: "POST" }));
      onChanged?.();
    } catch (e) { setErr(e.message); } finally { setLoading(false); }
  };

  return (
    <AnimatePresence>
      {open && app && (
        <motion.div className="fixed inset-0 z-[60] flex flex-col bg-navy-950/95 backdrop-blur" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          role="dialog" aria-modal="true" aria-label="Photo evidence">
          <div className="flex items-center justify-between gap-3 px-5 py-3 text-white">
            <div>
              <p className="font-mono text-xs text-white/50">{app.ref}</p>
              <p className="font-bold">Photo evidence · {app.fullName}</p>
            </div>
            <div className="flex items-center gap-2">
              {res && (
                <button onClick={() => setLabels(!labels)} className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-2 text-xs font-semibold hover:bg-white/20">
                  {labels ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />} {labels ? "Hide labels" : "Show labels"}
                </button>
              )}
              <button onClick={onClose} className="rounded-full bg-white/10 p-2 hover:bg-white/20" aria-label="Close"><X className="h-5 w-5" /></button>
            </div>
          </div>

          <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-5 pb-5 lg:grid-cols-[minmax(0,1fr)_380px] lg:overflow-hidden">
            {/* Image + boxes */}
            <div className="flex min-h-0 items-center justify-center">
              {/* Sized so the photo fills the space (small photos are scaled up) while the boxes stay aligned */}
              <div className="relative overflow-hidden rounded-2xl bg-black/30"
                style={{ width: `min(100%, 1400px, calc((100vh - 150px) * ${ratio}))`, aspectRatio: String(ratio) }}>
                <img src={`/api/staff/applications/${app.id}/photo`} alt="Photo sent by the applicant"
                  onLoad={(e) => e.target.naturalWidth && setRatio(e.target.naturalWidth / e.target.naturalHeight)}
                  className="absolute inset-0 block h-full w-full select-none" draggable={false} />
                {loading && (
                  <motion.div className="pointer-events-none absolute inset-x-0 h-24 bg-gradient-to-b from-transparent via-brand-500/40 to-transparent"
                    initial={{ top: "-20%" }} animate={{ top: "100%" }} transition={{ duration: 1.6, repeat: Infinity, ease: "linear" }} />
                )}
                {res && labels && res.objects.map((o, i) => {
                  const [ymin, xmin, ymax, xmax] = o.box;
                  const k = KIND[o.kind] || KIND.context;
                  const dim = hover !== null && hover !== i;
                  return (
                    <motion.div key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
                      initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: dim ? 0.25 : 1, scale: 1 }}
                      transition={{ delay: hover === null ? 0.15 + i * 0.18 : 0, type: "spring", stiffness: 220, damping: 22 }}
                      className="absolute rounded-lg"
                      style={{ top: `${ymin / 10}%`, left: `${xmin / 10}%`, height: `${(ymax - ymin) / 10}%`, width: `${(xmax - xmin) / 10}%`,
                        border: `2.5px solid ${k.color}`, background: hover === i ? `${k.color}22` : "transparent",
                        boxShadow: "0 0 0 1px rgba(0,0,0,0.35)" }}>
                      <span className="absolute left-0 flex max-w-[260px] items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-bold text-white shadow-lg"
                        style={{ background: k.color, ...(ymin < 70 ? { top: 4, left: 4 } : { bottom: "100%", marginBottom: 3 }) }}>
                        <span className="grid h-4 w-4 place-items-center rounded-full bg-white/25 text-[10px]">{i + 1}</span>
                        <span className="truncate">{o.label}</span>
                      </span>
                      {hover === i && o.note && (
                        <span className="absolute left-0 top-full z-10 mt-1 w-56 rounded-lg bg-navy-950/95 p-2 text-[11px] font-medium leading-snug text-white shadow-xl">{o.note}</span>
                      )}
                    </motion.div>
                  );
                })}
              </div>
            </div>

            {/* Side panel */}
            <aside className="min-h-0 space-y-3 overflow-y-auto rounded-3xl bg-white/[0.06] p-4 text-white scrollbar-thin">
              {!res && (
                <div className="grid place-items-center gap-3 py-8 text-center">
                  <span className="grid h-14 w-14 place-items-center rounded-full bg-sun-400 text-navy-900"><ScanSearch className="h-7 w-7" /></span>
                  <p className="font-bold">Analyse this photo with AI</p>
                  <p className="max-w-xs text-sm text-white/70">The AI marks what it sees (water, damage, appliances…), estimates the water level, and checks whether the photo fits the story.</p>
                  <Button variant="sun" icon={loading ? undefined : Sparkles} loading={loading} onClick={() => analyse(false)}>{loading ? "Analysing…" : "Analyse photo"}</Button>
                </div>
              )}
              {err && <p className="rounded-2xl bg-coral-500/20 p-3 text-sm">{err}</p>}
              {res && (
                <>
                  <div className="flex items-center gap-4 rounded-2xl bg-white/[0.07] p-4">
                    <MatchRing value={res.storyMatch} />
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wide text-sun-400">Photo vs. story</p>
                      <p className="mt-1 text-sm text-white/90">{res.matchReason}</p>
                    </div>
                  </div>
                  <p className="text-sm text-white/90">{res.summary}</p>
                  <div className="flex flex-wrap gap-2 text-xs font-semibold">
                    <span className={`rounded-full px-2.5 py-1 ${(AUTH[res.authenticity] || AUTH.unclear)[1]}`}>{(AUTH[res.authenticity] || AUTH.unclear)[0]}</span>
                    {res.scene !== "unclear" && <span className="rounded-full bg-white/15 px-2.5 py-1 capitalize">{res.scene}</span>}
                    {res.waterDepth && <span className="rounded-full bg-brand-600 px-2.5 py-1">Water: {res.waterDepth}</span>}
                  </div>
                  {res.concerns?.length > 0 && (
                    <ul className="space-y-1 rounded-2xl bg-coral-500/15 p-3 text-xs text-white/90">
                      {res.concerns.map((c) => <li key={c} className="flex gap-2"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sun-400" />{c}</li>)}
                    </ul>
                  )}
                  <div>
                    <p className="mb-2 text-xs font-bold uppercase tracking-wide text-white/50">What the AI found · {res.objects.length}</p>
                    <ul className="space-y-1.5">
                      {res.objects.map((o, i) => (
                        <motion.li key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
                          initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 + i * 0.18 }}
                          className={`flex cursor-default gap-3 rounded-2xl p-2.5 transition ${hover === i ? "bg-white/20" : "bg-white/[0.07]"}`}>
                          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-extrabold text-white" style={{ background: (KIND[o.kind] || KIND.context).color }}>{i + 1}</span>
                          <div className="min-w-0">
                            <p className="text-sm font-bold">{o.label} <span className="ml-1 text-[10px] font-semibold uppercase text-white/50">{(KIND[o.kind] || KIND.context).label}</span></p>
                            {o.note && <p className="text-xs text-white/70">{o.note}</p>}
                          </div>
                        </motion.li>
                      ))}
                      {res.objects.length === 0 && <li className="text-sm text-white/60">No clear objects were marked.</li>}
                    </ul>
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[11px] text-white/40">{res.provider}{res.at ? ` · ${timeAgo(res.at)}` : ""}</span>
                    <button onClick={() => analyse(true)} disabled={loading} className="flex items-center gap-1.5 text-xs font-semibold text-sun-400 disabled:opacity-50">
                      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Analyse again
                    </button>
                  </div>
                  <p className="text-[11px] text-white/40">AI labels are a guide for staff, not proof. Boxes can be imprecise.</p>
                </>
              )}
            </aside>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ---------------------------------------------------------------- Pay one family
export function PayModal({ app, open, onClose, onPaid }) {
  const [chk, setChk] = useState(null);
  const [amount, setAmount] = useState("");
  const [purpose, setPurpose] = useState("other");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const toast = useToast();

  useEffect(() => {
    if (!open || !app) return;
    setChk(null); setDone(null); setNote(""); setReason("");
    api(`/api/staff/applications/${app.id}/pay-check`).then((c) => {
      setChk(c); setAmount(String(c.amountUsd || "")); setPurpose(c.purpose || "other");
    }).catch((e) => { toast(e.message, "error"); onClose(); });
  }, [open, app?.id]); // eslint-disable-line

  const pay = async () => {
    setBusy(true);
    try {
      const r = await api(`/api/staff/applications/${app.id}/pay`, { method: "POST",
        body: { amount_usd: Number(amount), purpose, note, reason_unverified: reason } });
      setDone(r);
      onPaid?.();
    } catch (e) { toast(e.message, "error"); } finally { setBusy(false); }
  };

  const n = Number(amount);
  const amountOk = chk && n > 0 && n <= chk.capUsd && n <= chk.availableUsd;
  const reasonOk = !chk?.needsReason || reason.trim().length >= 10;

  return (
    <Modal open={open} onClose={() => !busy && onClose()} width="max-w-xl">
      {done ? (
        <div className="relative grid place-items-center py-4 text-center">
          <Confetti fire />
          <SuccessCheck size={80} />
          <p className="mt-4 text-2xl font-extrabold text-navy-900">{money(done.amountUsd, 2)} sent to {app.fullName}</p>
          <p className="mt-1 text-sm text-slate-500">PayPal batch <span className="font-mono">{done.paypalBatchId}</span> · {done.status}</p>
          <Button className="mt-5" onClick={onClose}>Done</Button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-brand-100 text-brand-600"><Banknote className="h-6 w-6" /></span>
            <div>
              <h3 className="text-lg font-extrabold text-navy-900">Pay {app?.fullName}</h3>
              <p className="text-sm text-slate-500">{app?.ref} · {app?.location} · one payment with PayPal Payouts</p>
            </div>
          </div>
          {!chk ? <p className="mt-6 text-sm text-slate-400">Running the checks…</p> : (
            <>
              <ul className="mt-5 space-y-1.5">
                {chk.checks.map((c, i) => {
                  const state = c.ok ? (c.warn ? "warn" : "ok") : c.level === "block" ? "bad" : "warn";
                  return (
                    <motion.li key={c.key} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.07 }}
                      className="flex items-center gap-3 rounded-2xl bg-canvas px-3 py-2 text-sm text-navy-900">
                      <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${state === "ok" ? "bg-leaf-100 text-leaf-500" : state === "warn" ? "bg-sun-100 text-amber-700" : "bg-coral-100 text-coral-500"}`}>
                        {state === "ok" ? <Check className="h-3.5 w-3.5" /> : state === "warn" ? <AlertTriangle className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                      </span>
                      {c.text}
                    </motion.li>
                  );
                })}
              </ul>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <label className="text-xs font-semibold text-slate-500">Amount (USD, max {money(Math.min(chk.capUsd, chk.availableUsd))})
                  <input className={`${inputCls} mt-1`} value={amount} inputMode="decimal" onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />
                </label>
                <label className="text-xs font-semibold text-slate-500">Purpose
                  <select className={`${inputCls} mt-1`} value={purpose} onChange={(e) => setPurpose(e.target.value)}>
                    {Object.entries(NEED_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
              </div>
              <label className="mt-3 block text-xs font-semibold text-slate-500">Note (optional)
                <input className={`${inputCls} mt-1`} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
              </label>
              {chk.needsReason && (
                <label className="mt-3 block text-xs font-semibold text-amber-700">The disaster was not confirmed. Why are you paying anyway? (required)
                  <textarea className={`${inputCls} mt-1`} rows={2} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. Field officer visited the home and saw the damage" />
                </label>
              )}
              {!chk.isAdmin && <p className="mt-3 rounded-2xl bg-sun-100 p-3 text-sm font-medium text-amber-800">Only an admin can send money. You can review the checks.</p>}
              <div className="mt-5 flex justify-end gap-2">
                <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
                <Button variant="blue" icon={Send} loading={busy} disabled={!chk.canPay || !amountOk || !reasonOk} onClick={pay}>
                  Send {amountOk ? money(n, 2) : ""} now
                </Button>
              </div>
            </>
          )}
        </>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------- Mark as fraud
export function FraudModal({ app, open, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => { if (open) setReason(""); }, [open]);
  const submit = async () => {
    setBusy(true);
    try {
      await api(`/api/staff/applications/${app.id}/mark-fraud`, { method: "POST", body: { reason } });
      toast(`${app.ref} marked as fraud. Future requests from this person will be flagged.`);
      onDone?.();
      onClose();
    } catch (e) { toast(e.message, "error"); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={() => !busy && onClose()}>
      <div className="flex items-center gap-3">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-coral-100 text-coral-500"><ShieldAlert className="h-6 w-6" /></span>
        <div>
          <h3 className="text-lg font-extrabold text-navy-900">Mark as fraud</h3>
          <p className="text-sm text-slate-500">{app?.fullName} · {app?.ref}</p>
        </div>
      </div>
      <p className="mt-4 text-sm text-slate-600">
        This rejects the request, sets it to high risk, and remembers the phone number, payout account and photo.
        Any later request that matches is flagged automatically. An admin can undo this.
      </p>
      <textarea className={`${inputCls} mt-4`} rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)}
        placeholder="What did you find? (at least 10 characters)" />
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="danger" icon={Flag} loading={busy} disabled={reason.trim().length < 10} onClick={submit}>Mark as fraud</Button>
      </div>
    </Modal>
  );
}
