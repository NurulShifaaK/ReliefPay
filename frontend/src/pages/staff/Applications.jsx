import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle, BadgeCheck, Banknote, BrainCircuit, Camera, Check, Flag, Globe2, Home, Mail, MapPin, Phone, RefreshCw,
  ScanSearch, Search, ShieldAlert, Undo2, Users, X,
} from "lucide-react";
import {
  Button, EmptyState, Page, RiskBadge, Skeleton, StatusBadge, UrgencyRing, inputCls, spring, useToast,
} from "../../components/ui";
import { DisasterCard, FraudModal, NEED_LABEL, PayModal, PhotoViewer } from "../../components/caseTools";
import { NEED_ICONS } from "../public/Apply";
import { useStaff } from "../../components/layouts";
import { api, money, timeAgo } from "../../lib/api";

const TABS = [["", "All"], ["PENDING", "Pending"], ["APPROVED", "Approved"], ["PAID", "Paid"], ["REJECTED", "Rejected"]];

export default function Applications() {
  const user = useStaff();
  const [params, setParams] = useSearchParams();
  const [apps, setApps] = useState(null);
  const [q, setQ] = useState("");
  const [payId, setPayId] = useState(null);
  const [fraudId, setFraudId] = useState(null);
  const [photoId, setPhotoId] = useState(null);
  const status = params.get("status") || "";
  const risk = params.get("risk") || "";
  const openId = Number(params.get("open")) || null;
  const toast = useToast();

  const load = useCallback(() => {
    const qs = new URLSearchParams();
    if (status) qs.set("status", status);
    if (risk) qs.set("risk", risk);
    return api(`/api/staff/applications?${qs}`).then(setApps).catch((e) => toast(e.message, "error"));
  }, [status, risk, toast]);

  useEffect(() => { load(); }, [load]);

  // Poll while any AI review is running
  useEffect(() => {
    if (!apps?.some((a) => a.ai.status === "QUEUED")) return;
    const t = setTimeout(load, 2500);
    return () => clearTimeout(t);
  }, [apps, load]);

  const shown = useMemo(() => {
    if (!apps) return null;
    const ql = q.trim().toLowerCase();
    return ql ? apps.filter((a) => `${a.ref} ${a.fullName} ${a.location}`.toLowerCase().includes(ql)) : apps;
  }, [apps, q]);

  const setParam = (k, v) => {
    const p = new URLSearchParams(params);
    v ? p.set(k, v) : p.delete(k);
    setParams(p, { replace: true });
  };

  const byId = (id) => apps?.find((a) => a.id === id);
  const open = byId(openId);

  // Escape closes the side panel (unless a dialog on top of it is open)
  useEffect(() => {
    if (!openId || payId || fraudId || photoId) return;
    const onKey = (e) => e.key === "Escape" && setParam("open", "");
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId, payId, fraudId, photoId]); // eslint-disable-line

  return (
    <Page>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-400">Dashboard › Applications</p>
          <h1 className="text-2xl font-extrabold tracking-tight text-navy-900 md:text-3xl">Requests for help</h1>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input className={`${inputCls} rounded-full bg-white pl-10`} placeholder="Search name, town, code" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-full bg-white p-1 shadow-[var(--shadow-card)]">
          {TABS.map(([k, label]) => (
            <button key={k} onClick={() => setParam("status", k)} className="relative rounded-full px-4 py-2 text-sm font-semibold">
              {status === k && <motion.span layoutId="app-tab" className="absolute inset-0 rounded-full bg-navy-900" transition={{ type: "spring", stiffness: 380, damping: 30 }} />}
              <span className={`relative ${status === k ? "text-white" : "text-slate-600"}`}>{label}</span>
            </button>
          ))}
        </div>
        <button onClick={() => setParam("risk", risk === "high" ? "" : "high")}
          className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition ${risk === "high" ? "bg-coral-500 text-white" : "bg-white text-coral-500 shadow-[var(--shadow-card)]"}`}>
          <ShieldAlert className="h-4 w-4" /> High risk only
        </button>
      </div>

      {!shown ? (
        <div className="space-y-3">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : shown.length === 0 ? (
        <EmptyState icon={Users} title="No requests here" text="Try another filter." />
      ) : (
        <motion.ul layout className="grid gap-3">
          <AnimatePresence initial={false}>
            {shown.map((a, i) => {
              const NeedIcon = NEED_ICONS[a.need] || NEED_ICONS.other;
              return (
                <motion.li key={a.id} layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i, 10) * 0.03 } }}
                  exit={{ opacity: 0, scale: 0.98 }}>
                  <div role="button" tabIndex={0} onClick={() => setParam("open", a.id)}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setParam("open", a.id))}
                    className="flex w-full cursor-pointer items-center gap-4 rounded-[24px] bg-white p-4 text-left shadow-[var(--shadow-card)] transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)]">
                    {a.ai.status === "QUEUED"
                      ? <span className="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-full bg-brand-100"><BrainCircuit className="h-5 w-5 animate-pulse text-brand-600" /></span>
                      : <UrgencyRing score={a.ai.urgency} />}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-navy-900">{a.fullName}</span>
                        <span className="font-mono text-xs text-slate-400">{a.ref}</span>
                        {a.markedFraud && <span className="rounded-full bg-coral-500 px-2 py-0.5 text-[10px] font-bold text-white">FRAUD</span>}
                        {a.isSeed && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-400">DEMO</span>}
                        {a.payoutMethod === "VENMO" && <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-bold text-brand-600">VENMO</span>}
                      </div>
                      <p className="truncate text-sm text-slate-500">{a.ai.status === "QUEUED" ? "AI is reading this request…" : a.ai.summary}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                        <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{a.location}</span>
                        <span className="flex items-center gap-1"><Users className="h-3 w-3" />{a.householdSize}</span>
                        <span className="flex items-center gap-1"><NeedIcon className="h-3 w-3" />{NEED_LABEL[a.need] || "Other"}</span>
                        {a.ai.language && <span className="flex items-center gap-1"><Globe2 className="h-3 w-3" />{a.ai.language}</span>}
                        {a.disaster.status === "confirmed" && <span className="flex items-center gap-1 font-semibold text-leaf-500"><BadgeCheck className="h-3 w-3" />Disaster confirmed</span>}
                        {a.disaster.status === "not_found" && <span className="flex items-center gap-1 font-semibold text-amber-700"><AlertTriangle className="h-3 w-3" />Disaster not confirmed</span>}
                        <span>{timeAgo(a.createdAt)}</span>
                      </div>
                    </div>
                    <div className="hidden flex-col items-end gap-2 sm:flex">
                      <StatusBadge status={a.status} />
                      <RiskBadge risk={a.fraud.risk} />
                    </div>
                    <div className="hidden w-28 text-right md:block">
                      <p className="text-lg font-extrabold text-navy-900">{money(a.approvedAmount ?? a.ai.suggestedAmount)}</p>
                      <p className="text-[11px] text-slate-400">{a.status === "PAID" ? "paid" : a.approvedAmount ? "approved" : "suggested"}</p>
                    </div>
                    {a.status === "APPROVED" && (
                      <motion.button whileTap={{ scale: 0.95 }} onClick={(e) => { e.stopPropagation(); setPayId(a.id); }}
                        className="flex shrink-0 items-center gap-1.5 rounded-full bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-500">
                        <Banknote className="h-4 w-4" /> Pay
                      </motion.button>
                    )}
                  </div>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </motion.ul>
      )}

      <Drawer app={open} user={user} onClose={() => setParam("open", "")} onChanged={load}
        onPay={() => setPayId(open.id)} onFraud={() => setFraudId(open.id)} onPhoto={() => setPhotoId(open.id)} />
      <PayModal app={byId(payId)} open={!!payId && !!byId(payId)} onClose={() => setPayId(null)} onPaid={load} />
      <FraudModal app={byId(fraudId)} open={!!fraudId && !!byId(fraudId)} onClose={() => setFraudId(null)} onDone={load} />
      <PhotoViewer app={byId(photoId)} open={!!photoId && !!byId(photoId)} onClose={() => setPhotoId(null)} onChanged={load} />
    </Page>
  );
}

function Drawer({ app, user, onClose, onChanged, onPay, onFraud, onPhoto }) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [imgOk, setImgOk] = useState(true);
  const toast = useToast();

  useEffect(() => {
    setAmount(app ? String(app.approvedAmount ?? app.ai.suggestedAmount ?? "") : "");
    setNote(""); setImgOk(true);
  }, [app?.id]); // eslint-disable-line

  const decide = async (decision) => {
    setBusy(decision);
    try {
      await api(`/api/staff/applications/${app.id}/decision`, {
        method: "POST", body: { decision, amount_usd: decision === "APPROVE" ? Number(amount) || null : null, note },
      });
      toast(decision === "APPROVE" ? `Approved ${money(amount)} for ${app.fullName}. You can pay now.` : `Rejected ${app.ref}`);
      await onChanged();
    } catch (e) { toast(e.message, "error"); } finally { setBusy(""); }
  };

  const post = async (key, path, okText) => {
    setBusy(key);
    try { await api(`/api/staff/applications/${app.id}/${path}`, { method: "POST" }); toast(okText); await onChanged(); }
    catch (e) { toast(e.message, "error"); } finally { setBusy(""); }
  };

  const editable = app && !app.markedFraud && ["PENDING", "APPROVED", "REJECTED"].includes(app.status);
  const photo = app?.photoAnalysis;

  return (
    <AnimatePresence>
      {app && (
        <>
          <motion.div className="fixed inset-0 z-40 bg-navy-950/30 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside role="dialog" aria-label={`Application ${app.ref}`}
            className="fixed inset-y-0 right-0 z-50 w-full max-w-2xl overflow-y-auto bg-white shadow-2xl scrollbar-thin sm:inset-y-3 sm:right-3 sm:rounded-[32px]"
            initial={{ x: "105%" }} animate={{ x: 0 }} exit={{ x: "105%" }} transition={spring}>
            <div className="sticky top-0 z-10 flex items-center justify-between bg-white/90 px-6 py-4 backdrop-blur">
              <div>
                <p className="font-mono text-xs text-slate-400">{app.ref}</p>
                <h2 className="text-xl font-extrabold text-navy-900">{app.fullName}</h2>
              </div>
              <div className="flex items-center gap-2">
                {app.status === "APPROVED" && !app.markedFraud && (
                  <Button variant="blue" icon={Banknote} onClick={onPay}>Pay this family</Button>
                )}
                <button onClick={onClose} className="rounded-full bg-canvas p-2 hover:bg-slate-200" aria-label="Close"><X className="h-5 w-5" /></button>
              </div>
            </div>

            <div className="space-y-5 px-6 pb-8">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={app.status} /><RiskBadge risk={app.fraud.risk} />
                <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-600">Need: {NEED_LABEL[app.need] || "Other"}</span>
              </div>

              {app.markedFraud && (
                <div className="flex items-start justify-between gap-3 rounded-3xl bg-coral-500 p-4 text-white">
                  <div>
                    <p className="flex items-center gap-2 text-sm font-bold"><Flag className="h-4 w-4" /> Marked as fraud by {app.markedBy}</p>
                    <p className="mt-1 text-sm text-white/90">“{app.fraudReason}”</p>
                  </div>
                  {user.role === "admin" && (
                    <button onClick={() => post("UNMARK", "unmark-fraud", "Fraud mark removed")} disabled={!!busy}
                      className="flex shrink-0 items-center gap-1 rounded-full bg-white/20 px-3 py-1.5 text-xs font-bold hover:bg-white/30"><Undo2 className="h-3.5 w-3.5" /> Unmark</button>
                  )}
                </div>
              )}

              {app.hasPhoto && imgOk ? (
                <div className="group relative overflow-hidden rounded-3xl">
                  <motion.img initial={{ opacity: 0, scale: 1.02 }} animate={{ opacity: 1, scale: 1 }}
                    src={`/api/staff/applications/${app.id}/photo`} alt="Damage photo" onError={() => setImgOk(false)}
                    onClick={onPhoto} className="h-64 w-full cursor-zoom-in object-cover transition group-hover:scale-[1.02]" />
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-navy-950/80 to-transparent p-3">
                    <span className="text-xs font-semibold text-white/90">
                      {photo ? `AI found ${photo.objects.length} things · story match ${photo.storyMatch}/100` : "Not analysed yet"}
                    </span>
                    <button onClick={onPhoto} className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-sun-400 px-4 py-2 text-xs font-bold text-navy-900 shadow-lg hover:brightness-105">
                      <ScanSearch className="h-4 w-4" /> View &amp; analyse photo
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid h-24 place-items-center rounded-3xl bg-canvas text-sm text-slate-400"><span className="flex items-center gap-2"><Camera className="h-4 w-4" /> No photo</span></div>
              )}

              {/* AI panel */}
              <div className="card-wave rounded-3xl bg-navy-900 p-5 text-white">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm font-bold"><BrainCircuit className="h-4 w-4 text-sun-400" /> AI assessment</span>
                  <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px]">{app.ai.provider || "pending"}</span>
                </div>
                {app.ai.status === "QUEUED" ? (
                  <p className="mt-4 animate-pulse text-sm text-white/80">Reading the request…</p>
                ) : (
                  <>
                    <div className="mt-4 flex items-center gap-4">
                      <div className="rounded-full bg-white p-1"><UrgencyRing score={app.ai.urgency} size={64} /></div>
                      <p className="text-sm text-white/90">{app.ai.reason}</p>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {app.ai.damage && <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold capitalize"><Home className="mr-1 inline h-3 w-3" />{app.ai.damage} damage</span>}
                      {app.ai.vulnerabilities.map((v) => <span key={v} className="rounded-full bg-sun-400 px-3 py-1 text-xs font-bold capitalize text-navy-900">{v.replace("_", " ")}</span>)}
                    </div>
                    <p className="mt-4 text-xs text-white/60"><Camera className="mr-1 inline h-3 w-3" />{app.ai.photoAssessment}</p>
                    {app.ai.error && (
                      <p className="mt-3 flex items-start gap-2 rounded-2xl bg-sun-400/20 p-3 text-xs text-white">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sun-400" />
                        <span>The AI was unavailable, so simple keyword rules were used. {app.ai.error} Then click “Re-run AI”.</span>
                      </p>
                    )}
                  </>
                )}
              </div>

              {app.ai.status !== "QUEUED" && (
                <DisasterCard app={app} busy={busy === "AI"} onRecheck={() => post("AI", "retriage", "Checking again…")} />
              )}

              {app.fraud.flags.length > 0 && (
                <div className="rounded-3xl bg-coral-100 p-4">
                  <p className="flex items-center gap-2 text-sm font-bold text-coral-500"><ShieldAlert className="h-4 w-4" /> Fraud signals</p>
                  <ul className="mt-2 space-y-1 text-sm text-navy-900">
                    {app.fraud.flags.map((f) => <li key={f}>• {f.replace(/^AI: /, "AI noticed: ")}</li>)}
                  </ul>
                </div>
              )}

              <div className="rounded-3xl bg-canvas p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400">In their words {app.ai.language && `· ${app.ai.language}`}</p>
                <p className="mt-2 whitespace-pre-wrap text-sm text-navy-900">{app.message}</p>
                {app.ai.summary && app.ai.language && !app.ai.language.startsWith("English") && (
                  <p className="mt-3 border-t border-slate-200 pt-3 text-sm italic text-slate-600">English: {app.ai.summary}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                {[[Phone, app.phone], [Mail, app.payoutMethod === "VENMO" ? `Venmo ${app.venmoPhone}` : app.paypalEmail], [MapPin, app.location], [Users, `${app.householdSize} people`]].map(([Icon, v], i) => (
                  <div key={i} className="flex items-center gap-2 truncate rounded-2xl bg-canvas p-3 text-navy-900"><Icon className="h-4 w-4 shrink-0 text-slate-400" /><span className="truncate">{v}</span></div>
                ))}
              </div>

              {app.decidedBy && (
                <p className="text-xs text-slate-500">Decided by {app.decidedBy} · {timeAgo(app.decidedAt)}{app.decisionNote && ` · "${app.decisionNote}"`}</p>
              )}

              {editable && (
                <div className="space-y-3 rounded-3xl border border-slate-100 p-4">
                  <p className="text-sm font-bold text-navy-900">Your decision</p>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-xs font-semibold text-slate-500">Amount (USD)
                      <input className={`${inputCls} mt-1`} value={amount} inputMode="decimal" onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />
                    </label>
                    <label className="text-xs font-semibold text-slate-500">Note {app.fraud.risk === "high" && <span className="text-coral-500">(required)</span>}
                      <input className={`${inputCls} mt-1`} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Why?" />
                    </label>
                  </div>
                  <p className="text-xs text-slate-400">AI fair-share suggestion: {money(app.ai.suggestedAmount)}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="success" icon={Check} loading={busy === "APPROVE"} disabled={!!busy || app.ai.status !== "DONE"} onClick={() => decide("APPROVE")}>
                      {app.status === "APPROVED" ? "Update approval" : "Approve"}
                    </Button>
                    <Button variant="ghost" icon={X} loading={busy === "REJECT"} disabled={!!busy} onClick={() => decide("REJECT")}>Reject</Button>
                    {app.status === "APPROVED" && <Button variant="blue" icon={Banknote} disabled={!!busy} onClick={onPay}>Pay this family</Button>}
                    <Button variant="ghost" icon={RefreshCw} loading={busy === "AI"} disabled={!!busy} onClick={() => post("AI", "retriage", "AI review restarted")} className="ml-auto">Re-run AI</Button>
                  </div>
                </div>
              )}

              {!app.markedFraud && (
                <button onClick={onFraud} className="flex items-center gap-2 text-sm font-semibold text-coral-500 hover:underline">
                  <Flag className="h-4 w-4" /> This person lied: mark as fraud
                </button>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
