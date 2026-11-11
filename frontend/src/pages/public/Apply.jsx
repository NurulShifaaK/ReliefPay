import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft, ArrowRight, BookOpen, Briefcase, Camera, Check, Copy, HeartPulse, Home, ImagePlus, Lock, Mic, MicOff,
  MoreHorizontal, Send, ShieldCheck, Smartphone, Trash2, Utensils, Wallet,
} from "lucide-react";
import { Button, Card, Confetti, Field, Page, SuccessCheck, inputCls, useToast } from "../../components/ui";
import { api } from "../../lib/api";
import { useI18n } from "../../lib/i18n";

const VOICE_LANGS = [
  ["en-US", "English"], ["hi-IN", "हिन्दी"], ["ta-IN", "தமிழ்"], ["fil-PH", "Filipino"], ["es-ES", "Español"],
  ["bn-IN", "বাংলা"], ["te-IN", "తెలుగు"], ["ml-IN", "മലയാളം"], ["id-ID", "Bahasa"], ["vi-VN", "Tiếng Việt"],
];

export const NEED_ICONS = { food: Utensils, shelter: Home, medical: HeartPulse, education: BookOpen, livelihood: Briefcase, other: MoreHorizontal };

const empty = { full_name: "", phone: "", location: "", household_size: 1, message: "", need_category: "", payout_method: "PAYPAL",
  paypal_email: "", venmo_phone: "", consent: false };

export default function Apply() {
  const { t, speech } = useI18n();
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [f, setF] = useState(empty);
  const [photo, setPhoto] = useState(null);
  const [preview, setPreview] = useState(null);
  const [errors, setErrors] = useState({});
  const [sending, setSending] = useState(false);
  const [venmoOn, setVenmoOn] = useState(false);
  const [ref, setRef] = useState(null);
  const toast = useToast();

  useEffect(() => { api("/api/public/config").then((c) => setVenmoOn(c.venmoEnabled)).catch(() => {}); }, []);
  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const STEPS = [t("apply.step1"), t("apply.step2"), t("apply.step3")];

  const validate = (s) => {
    const e = {};
    if (s === 0) {
      if (f.full_name.trim().length < 2) e.full_name = t("err.name");
      if (!/^[+\d][\d\s\-()]{6,24}$/.test(f.phone.trim())) e.phone = t("err.phone");
      if (f.location.trim().length < 2) e.location = t("err.location");
    }
    if (s === 1) {
      if (f.message.trim().length < 15) e.message = t("err.message");
      if (!(f.household_size >= 1 && f.household_size <= 30)) e.household_size = t("err.people");
    }
    if (s === 2) {
      if (f.payout_method === "PAYPAL" && !/^\S+@\S+\.\S+$/.test(f.paypal_email.trim())) e.paypal_email = t("err.email");
      if (f.payout_method === "VENMO" && f.venmo_phone.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "").length !== 10) e.venmo_phone = t("err.venmo");
      if (!f.consent) e.consent = t("err.consent");
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const go = (d) => {
    if (d > 0 && !validate(step)) return;
    setDir(d);
    setStep((s) => s + d);
  };

  const onPhoto = (file) => {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return toast(t("err.photoType"), "error");
    if (file.size > 6 * 1024 * 1024) return toast(t("err.photoSize"), "error");
    setPhoto(file);
    setPreview(URL.createObjectURL(file));
  };

  const submit = async () => {
    if (!validate(2)) return;
    setSending(true);
    const form = new FormData();
    Object.entries(f).forEach(([k, v]) => form.append(k, String(v)));
    if (photo) form.append("photo", photo);
    try {
      const r = await api("/api/public/applications", { method: "POST", form });
      setRef(r.ref);
    } catch (e) { toast(e.message, "error"); } finally { setSending(false); }
  };

  if (ref) return <Success refCode={ref} t={t} />;

  return (
    <Page className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
     <div>
      <div className="mb-6 text-center lg:text-left">
        <h1 className="text-3xl font-extrabold tracking-tight text-navy-900 md:text-4xl">{t("apply.title")}</h1>
        <p className="mt-2 text-slate-500">{t("apply.subtitle")}</p>
      </div>

      <div className="mb-5 flex items-center gap-2 rounded-full bg-white p-1.5 shadow-[var(--shadow-card)]">
        {STEPS.map((s, i) => (
          <div key={i} className="relative flex-1 rounded-full py-2 text-center text-xs font-bold md:text-sm">
            {i === step && <motion.span layoutId="step" className="absolute inset-0 rounded-full bg-navy-900" transition={{ type: "spring", stiffness: 380, damping: 30 }} />}
            <span className={`relative flex items-center justify-center gap-1.5 ${i === step ? "text-white" : i < step ? "text-leaf-500" : "text-slate-400"}`}>
              {i < step ? <Check className="h-4 w-4" /> : <span>{i + 1}</span>} <span className="truncate">{s}</span>
            </span>
          </div>
        ))}
      </div>

      <Card className="overflow-hidden p-6 md:p-8" initial="hidden" animate="show">
        <AnimatePresence mode="wait" custom={dir}>
          <motion.div key={step} initial={{ opacity: 0, x: dir * 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: dir * -40 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }} className="space-y-5">
            {step === 0 && (
              <>
                <Field label={t("apply.name")} error={errors.full_name}>
                  <input className={inputCls} value={f.full_name} onChange={set("full_name")} autoComplete="name" maxLength={80} />
                </Field>
                <Field label={t("apply.phone")} hint={t("apply.phoneHint")} error={errors.phone}>
                  <input className={inputCls} value={f.phone} onChange={set("phone")} inputMode="tel" autoComplete="tel" placeholder="+63 917 000 0000" maxLength={25} />
                </Field>
                <Field label={t("apply.location")} error={errors.location}>
                  <input className={inputCls} value={f.location} onChange={set("location")} placeholder={t("apply.locationPh")} maxLength={80} />
                </Field>
              </>
            )}
            {step === 1 && (
              <>
                <Field label={t("apply.what")} error={errors.message} hint={t("apply.whatHint")}>
                  <VoiceTextarea value={f.message} onChange={(v) => setF((x) => ({ ...x, message: v }))} t={t} defaultLang={speech} />
                </Field>
                <div>
                  <p className="mb-2 text-sm font-semibold text-navy-900">{t("apply.need")}</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {Object.entries(NEED_ICONS).map(([k, Icon]) => (
                      <motion.button key={k} type="button" whileTap={{ scale: 0.95 }}
                        onClick={() => setF((x) => ({ ...x, need_category: x.need_category === k ? "" : k }))}
                        className={`flex items-center gap-2 rounded-2xl px-3 py-2.5 text-left text-sm font-semibold transition ${f.need_category === k ? "bg-navy-900 text-white" : "bg-canvas text-navy-900 hover:bg-slate-200"}`}>
                        <Icon className="h-4 w-4 shrink-0" /> <span className="truncate">{t(`need.${k}`)}</span>
                      </motion.button>
                    ))}
                  </div>
                </div>
                <Field label={t("apply.people")} error={errors.household_size}>
                  <div className="flex items-center gap-3">
                    {[-1, 1].map((d) => (
                      <motion.button key={d} type="button" whileTap={{ scale: 0.9 }}
                        onClick={() => setF((x) => ({ ...x, household_size: Math.min(30, Math.max(1, Number(x.household_size) + d)) }))}
                        className="grid h-11 w-11 place-items-center rounded-full bg-canvas text-xl font-bold text-navy-900 hover:bg-slate-200"
                        aria-label={d < 0 ? "Fewer" : "More"}>{d < 0 ? "−" : "+"}</motion.button>
                    ))}
                    <motion.span key={f.household_size} initial={{ scale: 1.3 }} animate={{ scale: 1 }} className="min-w-12 text-center text-2xl font-extrabold text-navy-900">
                      {f.household_size}
                    </motion.span>
                    <span className="text-sm text-slate-500">{t("apply.peopleUnit")}</span>
                  </div>
                </Field>
                <Field label={t("apply.photo")}>
                  {preview ? (
                    <div className="relative overflow-hidden rounded-3xl">
                      <img src={preview} alt="" className="h-52 w-full object-cover" />
                      <button type="button" onClick={() => { setPhoto(null); setPreview(null); }}
                        className="absolute right-3 top-3 rounded-full bg-white/90 p-2 text-coral-500 shadow" aria-label="Remove photo">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <label className="flex cursor-pointer flex-col items-center gap-2 rounded-3xl border-2 border-dashed border-slate-200 p-8 text-center transition hover:border-brand-500 hover:bg-brand-50"
                      onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onPhoto(e.dataTransfer.files[0]); }}>
                      <span className="grid h-12 w-12 place-items-center rounded-full bg-brand-100 text-brand-600"><ImagePlus className="h-6 w-6" /></span>
                      <span className="text-sm font-semibold text-navy-900">{t("apply.photoTap")}</span>
                      <span className="text-xs text-slate-500">{t("apply.photoHint")}</span>
                      <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="hidden"
                        onChange={(e) => onPhoto(e.target.files[0])} />
                    </label>
                  )}
                </Field>
              </>
            )}
            {step === 2 && (
              <>
                <div>
                  <p className="mb-2 text-sm font-semibold text-navy-900">{t("apply.method")}</p>
                  <div className="grid grid-cols-2 gap-2">
                    {[["PAYPAL", t("apply.viaPaypal"), Wallet], ...(venmoOn ? [["VENMO", t("apply.viaVenmo"), Smartphone]] : [])].map(([k, label, Icon]) => (
                      <button key={k} type="button" onClick={() => setF((x) => ({ ...x, payout_method: k }))}
                        className={`relative flex items-center justify-center gap-2 rounded-2xl py-3 text-sm font-bold transition ${f.payout_method === k ? "text-white" : "bg-canvas text-navy-900"}`}>
                        {f.payout_method === k && <motion.span layoutId="method" className="absolute inset-0 rounded-2xl bg-navy-900" />}
                        <Icon className="relative h-4 w-4" /><span className="relative">{label}</span>
                      </button>
                    ))}
                  </div>
                </div>
                {f.payout_method === "PAYPAL" ? (
                  <Field label={t("apply.paypalEmail")} hint={t("apply.paypalHint")} error={errors.paypal_email}>
                    <input className={inputCls} value={f.paypal_email} onChange={set("paypal_email")} type="email" autoComplete="email" maxLength={120} />
                  </Field>
                ) : (
                  <Field label={t("apply.venmoPhone")} error={errors.venmo_phone}>
                    <input className={inputCls} value={f.venmo_phone} onChange={set("venmo_phone")} inputMode="tel" placeholder="(713) 555-0100" maxLength={20} />
                  </Field>
                )}
                <div className="rounded-3xl bg-canvas p-4 text-sm text-slate-600">
                  <p className="flex items-center gap-2 font-semibold text-navy-900"><Lock className="h-4 w-4" /> {t("apply.privacyTitle")}</p>
                  <p className="mt-1">{t("apply.privacyText")}</p>
                </div>
                <label className="flex items-start gap-3 text-sm">
                  <input type="checkbox" checked={f.consent} onChange={set("consent")} className="mt-0.5 h-5 w-5 accent-[#13235b]" />
                  <span className="text-slate-700">{t("apply.consent")}</span>
                </label>
                {errors.consent && <p className="text-xs font-medium text-coral-500">{errors.consent}</p>}
              </>
            )}
          </motion.div>
        </AnimatePresence>

        <div className="mt-8 flex justify-between gap-3">
          {step > 0 ? <Button variant="ghost" icon={ArrowLeft} onClick={() => go(-1)}>{t("apply.back")}</Button> : <span />}
          {step < 2
            ? <Button icon={ArrowRight} onClick={() => go(1)}>{t("apply.continue")}</Button>
            : <Button variant="sun" icon={Send} loading={sending} onClick={submit}>{t("apply.send")}</Button>}
        </div>
      </Card>
     </div>

      {/* Side panel: what happens next */}
      <aside className="space-y-4 lg:pt-[104px]">
        <div className="card-wave rounded-[28px] bg-navy-900 p-6 text-white shadow-[var(--shadow-card)]">
          <h2 className="text-lg font-bold">{t("apply.nextTitle")}</h2>
          <ol className="mt-4 space-y-4">
            {[1, 2, 3, 4].map((n, i) => (
              <motion.li key={n} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 + i * 0.1 }} className="flex gap-3">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-sun-400 text-xs font-extrabold text-navy-900">{n}</span>
                <span className="text-sm text-white/90">{t(`apply.next${n}`)}</span>
              </motion.li>
            ))}
          </ol>
        </div>
        <div className="flex items-start gap-3 rounded-[28px] bg-white p-5 shadow-[var(--shadow-card)]">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-leaf-100 text-leaf-500"><ShieldCheck className="h-5 w-5" /></span>
          <p className="text-sm font-medium text-slate-600">{t("apply.free")}</p>
        </div>
      </aside>
    </Page>
  );
}

function VoiceTextarea({ value, onChange, t, defaultLang }) {
  const Rec = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
  const [lang, setLang] = useState(VOICE_LANGS.some(([c]) => c === defaultLang) ? defaultLang : "en-US");
  const [listening, setListening] = useState(false);
  const recRef = useRef(null);
  const baseRef = useRef("");

  const toggle = () => {
    if (listening) { recRef.current?.stop(); return; }
    const rec = new Rec();
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = true;
    baseRef.current = value ? value.trimEnd() + " " : "";
    rec.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      onChange((baseRef.current + text).slice(0, 3000));
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  };
  useEffect(() => () => recRef.current?.stop(), []);

  return (
    <div className={`rounded-3xl border bg-slate-50/60 transition ${listening ? "border-coral-500 ring-4 ring-coral-100" : "border-slate-200 focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-100"}`}>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={5} maxLength={3000}
        className="w-full resize-none rounded-3xl bg-transparent px-4 pt-3 text-sm text-navy-900 outline-none" placeholder={t("apply.writeHere")} />
      <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-2">
        {Rec ? (
          <div className="flex items-center gap-2">
            <motion.button type="button" onClick={toggle} whileTap={{ scale: 0.9 }}
              className={`relative flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold ${listening ? "bg-coral-500 text-white" : "bg-navy-900 text-white"}`}>
              {listening && <span className="absolute inset-0 animate-ping rounded-full bg-coral-500/40" />}
              {listening ? <MicOff className="relative h-4 w-4" /> : <Mic className="relative h-4 w-4" />}
              <span className="relative">{listening ? t("apply.stop") : t("apply.speak")}</span>
            </motion.button>
            <select value={lang} onChange={(e) => setLang(e.target.value)} disabled={listening}
              className="rounded-full bg-white px-3 py-2 text-xs font-semibold text-navy-900 ring-1 ring-slate-200" aria-label="Voice language">
              {VOICE_LANGS.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
            </select>
          </div>
        ) : <span className="text-xs text-slate-400">{t("apply.voiceUnsupported")}</span>}
        <span className="text-xs text-slate-400">{value.length}/3000</span>
      </div>
    </div>
  );
}

function Success({ refCode, t }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(refCode); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ }
  };
  return (
    <Page className="mx-auto max-w-lg">
      <Card className="relative mt-6 p-8 text-center" initial="hidden" animate="show">
        <Confetti fire />
        <div className="grid place-items-center"><SuccessCheck size={84} /></div>
        <h1 className="mt-4 text-2xl font-extrabold text-navy-900">{t("apply.received")}</h1>
        <p className="mt-2 text-slate-500">{t("apply.saveCode")}</p>
        <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.4, type: "spring" }}
          className="mx-auto mt-5 flex w-fit items-center gap-3 rounded-full bg-navy-900 py-2 pl-6 pr-2 text-white">
          <span className="font-mono text-2xl font-bold tracking-widest">{refCode}</span>
          <button onClick={copy} className="rounded-full bg-white/15 p-2.5 hover:bg-white/25" aria-label="Copy code">
            {copied ? <Check className="h-4 w-4 text-sun-400" /> : <Copy className="h-4 w-4" />}
          </button>
        </motion.div>
        <div className="mt-6 flex justify-center gap-2">
          <Link to="/track" className="rounded-full bg-sun-400 px-5 py-2.5 text-sm font-bold text-navy-900">{t("apply.trackBtn")}</Link>
          <Link to="/" className="rounded-full bg-canvas px-5 py-2.5 text-sm font-semibold text-navy-900">{t("apply.home")}</Link>
        </div>
        <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-slate-400"><Camera className="h-3.5 w-3.5" /> {t("apply.tip")}</p>
      </Card>
    </Page>
  );
}
