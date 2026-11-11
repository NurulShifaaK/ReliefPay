import { useState } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { CheckCircle2, CircleDashed, HelpCircle, Languages, Search, Volume2, XCircle } from "lucide-react";
import { Button, Card, Field, Page, inputCls, useToast } from "../../components/ui";
import { api, money, speak } from "../../lib/api";
import { useI18n } from "../../lib/i18n";

const FLOW = ["PENDING", "APPROVED", "PAID"];

export default function Track() {
  const { t } = useI18n();
  const [ref, setRef] = useState("");
  const [last4, setLast4] = useState("");
  const [res, setRes] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const toast = useToast();
  const LABEL = { PENDING: t("track.received"), APPROVED: t("track.approved"), PAID: t("track.sent") };

  const check = async (e) => {
    e.preventDefault();
    setErr(""); setRes(null); setLoading(true);
    try {
      setRes(await api(`/api/public/applications/status?ref=${encodeURIComponent(ref.trim())}&phone_last4=${encodeURIComponent(last4.trim())}`));
    } catch (e2) { setErr(e2.message); } finally { setLoading(false); }
  };

  const listen = (text, lang) => {
    if (!speak(text, lang || "en-US")) toast("Your browser can't read this aloud.", "error");
  };

  const idx = res ? FLOW.indexOf(res.status) : -1;

  return (
    <Page className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
     <div>
      <div className="mb-6 text-center lg:text-left">
        <h1 className="text-3xl font-extrabold tracking-tight text-navy-900 md:text-4xl">{t("track.title")}</h1>
        <p className="mt-2 text-slate-500">{t("track.subtitle")}</p>
      </div>
      <Card initial="hidden" animate="show" className="p-6">
        <form onSubmit={check} className="grid gap-4 sm:grid-cols-[1.4fr_1fr_auto] sm:items-end">
          <Field label={t("track.code")}>
            <input className={`${inputCls} font-mono uppercase`} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="RP-XXXXXX" maxLength={12} required />
          </Field>
          <Field label={t("track.last4")}>
            <input className={inputCls} value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" placeholder="1234" required />
          </Field>
          <Button icon={Search} loading={loading} type="submit">{t("track.check")}</Button>
        </form>
        {err && <motion.p initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="mt-4 rounded-2xl bg-coral-100 p-3 text-sm font-medium text-coral-500">{err}</motion.p>}
      </Card>

      {res && (
        <Card initial="hidden" animate="show" className="mt-5 p-6">
          <div className="flex items-center justify-between">
            <span className="font-mono text-sm font-bold text-slate-500">{res.ref}</span>
            {res.amount && <span className="rounded-full bg-leaf-100 px-3 py-1 text-sm font-bold text-leaf-500">{money(res.amount)}{res.payoutMethod === "VENMO" && " · Venmo"}</span>}
          </div>

          {res.local && (
            <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
              className="card-wave mt-4 rounded-3xl bg-navy-900 p-5 text-white">
              <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-sun-400">
                <Languages className="h-4 w-4" /> {t("track.inYourLanguage")} · {res.local.language}
              </p>
              <p className="mt-2 text-lg font-bold leading-snug">{res.local.text}</p>
              {res.local.speech && (
                <motion.button whileTap={{ scale: 0.94 }} onClick={() => listen(res.local.text, res.local.speech)}
                  className="mt-3 inline-flex items-center gap-2 rounded-full bg-sun-400 px-4 py-2 text-sm font-bold text-navy-900">
                  <Volume2 className="h-4 w-4" /> {t("track.listen")}
                </motion.button>
              )}
            </motion.div>
          )}

          <div className="mt-4 flex items-start justify-between gap-3">
            <p className="text-lg font-bold text-navy-900">{res.message}</p>
            <button onClick={() => listen(res.message, "en-US")} className="rounded-full bg-canvas p-2 text-navy-900" aria-label={t("track.listen")}>
              <Volume2 className="h-4 w-4" />
            </button>
          </div>

          {res.status === "REJECTED" ? (
            <div className="mt-6 flex items-center gap-3 rounded-2xl bg-slate-100 p-4 text-slate-600"><XCircle className="h-6 w-6" /> {t("track.notApproved")}</div>
          ) : (
            <ol className="mt-6">
              {FLOW.map((s, i) => {
                const done = i <= idx;
                return (
                  <motion.li key={s} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.15 }} className="flex gap-4">
                    <div className="flex flex-col items-center">
                      {done ? <CheckCircle2 className="h-7 w-7 text-leaf-500" /> : <CircleDashed className="h-7 w-7 text-slate-300" />}
                      {i < FLOW.length - 1 && (
                        <div className="relative my-1 h-10 w-1 overflow-hidden rounded-full bg-slate-100">
                          <motion.div className="absolute inset-x-0 top-0 bg-leaf-500" initial={{ height: 0 }}
                            animate={{ height: i < idx ? "100%" : 0 }} transition={{ delay: 0.3 + i * 0.2, duration: 0.5 }} />
                        </div>
                      )}
                    </div>
                    <div className="pt-0.5">
                      <p className={`font-bold ${done ? "text-navy-900" : "text-slate-400"}`}>{LABEL[s]}</p>
                      {s === "PENDING" && <p className="text-xs text-slate-500">{new Date(res.submittedAt).toLocaleString()}</p>}
                      {s === "PAID" && res.paidAt && <p className="text-xs text-slate-500">{new Date(res.paidAt).toLocaleString()}</p>}
                    </div>
                  </motion.li>
                );
              })}
            </ol>
          )}
        </Card>
      )}
     </div>
      <aside className="lg:pt-[104px]">
        <div className="rounded-[28px] bg-white p-6 shadow-[var(--shadow-card)]">
          <h2 className="flex items-center gap-2 text-lg font-bold text-navy-900"><HelpCircle className="h-5 w-5 text-brand-600" /> {t("track.helpTitle")}</h2>
          <ul className="mt-4 space-y-3 text-sm text-slate-600">
            {[1, 2, 3].map((n) => (
              <li key={n} className="flex gap-3"><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-sun-400" />{t(`track.help${n}`)}</li>
            ))}
          </ul>
          <Link to="/apply" className="mt-5 inline-flex rounded-full bg-canvas px-4 py-2 text-sm font-semibold text-navy-900 hover:bg-slate-200">{t("nav.help")} →</Link>
        </div>
      </aside>
    </Page>
  );
}
