import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { PayPalButtons, PayPalScriptProvider } from "@paypal/react-paypal-js";
import { ArrowRight, Bot, Copy, HandCoins, HeartHandshake, Repeat, ShieldCheck, Sparkles, Trophy, Zap } from "lucide-react";
import { AnimatedNumber, Card, Confetti, Page, Skeleton, SuccessCheck, inputCls, rise, stagger, useToast } from "../../components/ui";
import { HeroCards } from "../../components/brand";
import { api, fmtCurrency, money, timeAgo } from "../../lib/api";
import { useI18n } from "../../lib/i18n";

const REGION_CURRENCY = { IN: "INR", GB: "GBP", AU: "AUD", CA: "CAD", SG: "SGD", JP: "JPY", PH: "PHP",
  DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR", NL: "EUR", IE: "EUR", PT: "EUR", BE: "EUR", AT: "EUR", FI: "EUR" };

function localCurrency(codes) {
  try {
    const region = new Intl.Locale(navigator.language).maximize().region;
    const guess = REGION_CURRENCY[region];
    return guess && codes.includes(guess) ? guess : "USD";
  } catch { return "USD"; }
}

export default function Donate() {
  const { t, lang } = useI18n();
  const [config, setConfig] = useState(null);
  const [stats, setStats] = useState(null);
  const [board, setBoard] = useState([]);
  const [mode, setMode] = useState("once");
  const [currency, setCurrency] = useState("USD");
  const [amount, setAmount] = useState(50);
  const [custom, setCustom] = useState("");
  const [name, setName] = useState("");
  const [showMe, setShowMe] = useState(true);
  const [plans, setPlans] = useState(null);
  const [tier, setTier] = useState(null);
  const [done, setDone] = useState(null);
  const toast = useToast();
  const ref = useRef({ amount: 50, currency: "USD", name: "", showMe: true });
  ref.current = { amount, currency, name, showMe };

  const load = () => {
    api("/api/public/stats").then(setStats).catch((e) => toast(e.message, "error"));
    api("/api/public/leaderboard?limit=5").then(setBoard).catch(() => {});
  };
  useEffect(() => {
    api("/api/public/config").then((c) => {
      setConfig(c);
      const start = localCurrency(c.currencies.map((x) => x.code));   // e.g. rupees for visitors in India
      if (start !== "USD") { setCurrency(start); setAmount(c.currencies.find((x) => x.code === start).chips[2]); }
    }).catch((e) => toast(e.message, "error"));
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const cur = useMemo(() => config?.currencies.find((c) => c.code === currency), [config, currency]);

  const pickCurrency = (code) => {
    const c = config.currencies.find((x) => x.code === code);
    setCurrency(code); setCustom(""); setAmount(c.chips[2]);
  };
  const onCustom = (v) => {
    const clean = v.replace(/[^\d.]/g, "").slice(0, 9);
    setCustom(clean);
    const n = parseFloat(clean);
    if (n > 0) setAmount(n);
  };

  const openMonthly = async () => {
    setMode("monthly");
    if (plans) return;
    try {
      const p = await api("/api/public/subscriptions/plans");
      setPlans(p);
      setTier(p[1]?.planId || p[0]?.planId);
    } catch (e) { toast(e.message, "error"); setPlans([]); }
  };

  const pct = config && stats ? Math.min(100, (stats.raisedUsd / config.goalUsd) * 100) : 0;
  const usdValue = cur ? amount * cur.rate : 0;
  const avgAid = stats?.avgAidUsd || 0;
  const impact = !avgAid || !usdValue ? null
    : usdValue >= avgAid ? t("donate.impactN", { n: String(Math.floor(usdValue / avgAid)), avg: money(avgAid) })
    : t("donate.impact", { pct: String(Math.max(1, Math.round((usdValue / avgAid) * 100))), avg: money(avgAid) });
  const ready = config?.paypalReady && config?.paypalClientId;
  const steps = [
    { icon: HeartHandshake, title: t("donate.s1t"), text: t("donate.s1") },
    { icon: Bot, title: t("donate.s2t"), text: t("donate.s2") },
    { icon: ShieldCheck, title: t("donate.s3t"), text: t("donate.s3") },
    { icon: Zap, title: t("donate.s4t"), text: t("donate.s4") },
  ];

  return (
    <Page>
      <motion.div variants={stagger} initial="hidden" animate="show" className="grid gap-5 lg:grid-cols-12">
        {/* Hero */}
        <Card className="relative flex overflow-hidden bg-gradient-to-br from-white to-brand-50 p-7 md:p-10 lg:col-span-7 xl:col-span-8">
          <div className="flex w-full flex-col justify-between gap-8 md:flex-row md:items-center">
            <div className="max-w-xl">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-coral-100 px-3 py-1 text-xs font-bold text-coral-500">
                <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-coral-500 opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-coral-500" /></span>
                {t("donate.badge")}
              </span>
              <h1 className={`mt-4 font-extrabold leading-[1.15] tracking-tight text-navy-900 ${lang === "en" || lang === "es" || lang === "fil" ? "text-4xl md:text-5xl 2xl:text-6xl" : "text-3xl md:text-4xl"}`}>
                {t("donate.title1")} <span className="text-brand-600">{t("donate.title2")}</span>{t("donate.title3")}
              </h1>
              <p className="mt-4 text-slate-600 xl:text-lg">{t("donate.intro", { campaign: config?.campaignName || "…" })}</p>
              <div className="mt-6 flex flex-wrap gap-3">
                <a href="#donate" className="inline-flex items-center gap-2 rounded-full bg-navy-900 px-6 py-3 text-sm font-semibold text-white hover:bg-navy-800">
                  {t("donate.cta")} <ArrowRight className="h-4 w-4" />
                </a>
                <Link to="/apply" className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-navy-900 ring-1 ring-slate-200 hover:bg-slate-50">
                  {t("donate.needHelp")}
                </Link>
              </div>
            </div>
            <div className="hidden shrink-0 sm:block xl:mr-6 xl:scale-110 2xl:mr-12 2xl:scale-125"><HeroCards /></div>
          </div>
        </Card>

        {/* Progress */}
        <Card className="order-3 flex flex-col gap-4 lg:order-2 lg:col-span-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-navy-900">{t("donate.campaign")}</h2>
            <Link to="/transparency" className="text-sm font-semibold text-slate-400 hover:text-navy-900">{t("donate.whereGoes")}</Link>
          </div>
          {stats && config ? (
            <>
              <div className="flex flex-1 flex-col justify-center rounded-3xl bg-canvas p-5">
                <p className="text-sm font-medium text-slate-500">{t("donate.raised")}</p>
                <p className="mt-1 text-4xl font-extrabold tracking-tight text-navy-900"><AnimatedNumber value={stats.raisedUsd} prefix="$" /></p>
                <div className="mt-4 h-3 overflow-hidden rounded-full bg-white">
                  <motion.div className="h-full rounded-full bg-gradient-to-r from-leaf-500 to-brand-600"
                    initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }} />
                </div>
                <p className="mt-2 text-xs font-medium text-slate-500">{t("donate.ofGoal", { pct: pct.toFixed(0), goal: money(config.goalUsd) })}</p>
              </div>
              <div className="grid grid-cols-3 gap-3 text-center">
                {[[t("donate.donors"), stats.donors, ""], [t("donate.familiesPaid"), stats.familiesHelped, ""], [t("donate.sent"), stats.sentUsd, "$"]].map(([l, v, p]) => (
                  <div key={l} className="rounded-2xl bg-white p-3 ring-1 ring-slate-100">
                    <div className="text-xl font-extrabold text-navy-900"><AnimatedNumber value={v} prefix={p} /></div>
                    <div className="text-[11px] font-medium text-slate-500">{l}</div>
                  </div>
                ))}
              </div>
            </>
          ) : <div className="space-y-3"><Skeleton className="h-36" /><Skeleton className="h-16" /></div>}
        </Card>

        {/* Donate box */}
        <Card id="donate" className="relative order-2 scroll-mt-24 lg:order-1 lg:col-span-5 xl:col-span-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-navy-900">{t("donate.give")}</h2>
            <div className="flex rounded-full bg-canvas p-1 text-xs font-bold">
              {[["once", t("donate.once")], ["monthly", t("donate.monthly")]].map(([k, label]) => (
                <button key={k} onClick={() => (k === "monthly" ? openMonthly() : setMode("once"))} className="relative rounded-full px-3 py-1.5">
                  {mode === k && <motion.span layoutId="mode" className="absolute inset-0 rounded-full bg-navy-900" />}
                  <span className={`relative flex items-center gap-1 ${mode === k ? "text-white" : "text-slate-600"}`}>
                    {k === "monthly" && <Repeat className="h-3 w-3" />}{label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {done ? (
            <DoneBox done={done} t={t} onAgain={() => setDone(null)} />
          ) : !config ? <Skeleton className="mt-4 h-60" /> : (
            <>
              {mode === "once" && (
                <>
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {config.currencies.map((c) => (
                      <button key={c.code} onClick={() => pickCurrency(c.code)}
                        className={`rounded-full px-3 py-1 text-xs font-bold transition ${currency === c.code ? "bg-brand-600 text-white" : "bg-canvas text-slate-600 hover:bg-slate-200"}`}>
                        {c.symbol} {c.code}
                      </button>
                    ))}
                  </div>
                  <div className="mt-3 grid grid-cols-5 gap-2">
                    {cur.chips.map((a) => (
                      <motion.button key={`${currency}-${a}`} whileTap={{ scale: 0.92 }} onClick={() => { setAmount(a); setCustom(""); }}
                        className={`relative rounded-2xl py-3 text-xs font-bold transition-colors sm:text-sm ${amount === a && !custom ? "text-white" : "bg-canvas text-navy-900 hover:bg-slate-200"}`}>
                        {amount === a && !custom && <motion.span layoutId="amt" className="absolute inset-0 rounded-2xl bg-navy-900" transition={{ type: "spring", stiffness: 400, damping: 30 }} />}
                        <span className="relative">{fmtCurrency(a, cur)}</span>
                      </motion.button>
                    ))}
                  </div>
                  <input className={`${inputCls} mt-3`} placeholder={`${t("donate.other")} (${currency})`} inputMode="decimal"
                    value={custom} onChange={(e) => onCustom(e.target.value)} aria-label={t("donate.other")} />
                  {currency !== "USD" && (
                    <p className="mt-1.5 text-xs font-medium text-slate-500">
                      {cur.charge !== currency ? t("donate.chargedAs", { usd: money(usdValue, 2) }) : t("donate.approx", { usd: money(usdValue, 2) })}
                    </p>
                  )}
                  {impact && (
                    <motion.p key={impact} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                      className="mt-2 flex items-start gap-2 rounded-2xl bg-leaf-100 px-3 py-2 text-xs font-semibold text-leaf-500">
                      <HeartHandshake className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span className="text-navy-900">{impact}</span>
                    </motion.p>
                  )}
                </>
              )}

              {mode === "monthly" && (
                <div className="mt-4">
                  {!plans ? <Skeleton className="h-16" /> : plans.length === 0 ? (
                    <p className="rounded-2xl bg-sun-100 p-3 text-sm text-amber-800">Monthly giving is not available right now.</p>
                  ) : (
                    <div className="grid grid-cols-3 gap-2">
                      {plans.map((p) => (
                        <motion.button key={p.planId} whileTap={{ scale: 0.94 }} onClick={() => setTier(p.planId)}
                          className={`relative rounded-2xl py-4 font-extrabold ${tier === p.planId ? "text-white" : "bg-canvas text-navy-900"}`}>
                          {tier === p.planId && <motion.span layoutId="tier" className="absolute inset-0 rounded-2xl bg-navy-900" />}
                          <span className="relative">${p.amountUsd}<span className="text-xs font-medium opacity-70">{t("donate.perMonth")}</span></span>
                        </motion.button>
                      ))}
                    </div>
                  )}
                  <p className="mt-2 text-xs text-slate-500">{t("donate.monthlyNote")}</p>
                </div>
              )}

              <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
                <input className={inputCls} placeholder={t("donate.nameLabel")} value={name} maxLength={40}
                  onChange={(e) => setName(e.target.value)} aria-label={t("donate.nameLabel")} />
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                  <input type="checkbox" checked={showMe} onChange={(e) => setShowMe(e.target.checked)} className="h-4 w-4 accent-[#13235b]" />
                  {t("donate.showMe")}
                </label>
              </div>

              <div className="mt-4 min-h-[120px]">
                {!ready ? (
                  <p className="rounded-2xl bg-sun-100 p-4 text-sm font-medium text-amber-800">{t("donate.notConfigured")}</p>
                ) : mode === "once" ? (
                  <PayPalScriptProvider key={`once-${cur.charge}`}
                    options={{ clientId: config.paypalClientId, currency: cur.charge, intent: "capture", components: "buttons" }}>
                    <PayPalButtons
                      style={{ layout: "vertical", shape: "pill", color: "gold", label: "donate", height: 46 }}
                      createOrder={async () => {
                        const r = ref.current;
                        const o = await api("/api/public/donations/create-order", { method: "POST", body: {
                          amount: r.amount, currency: r.currency, display_name: r.name, show_on_leaderboard: r.showMe } });
                        return o.id;
                      }}
                      onApprove={async ({ orderID }) => {
                        try {
                          const r = await api(`/api/public/donations/${orderID}/capture`, { method: "POST" });
                          setDone({ ...r, kind: "once" });
                          load();
                        } catch (e) { toast(e.message, "error"); }
                      }}
                      onError={(err) => toast(err?.message || "PayPal could not start. Please try again.", "error")}
                    />
                  </PayPalScriptProvider>
                ) : tier ? (
                  <PayPalScriptProvider key="monthly"
                    options={{ clientId: config.paypalClientId, vault: true, intent: "subscription", components: "buttons" }}>
                    <PayPalButtons
                      forceReRender={[tier]}
                      style={{ layout: "vertical", shape: "pill", color: "blue", label: "subscribe", height: 46 }}
                      createSubscription={(_d, actions) => actions.subscription.create({ plan_id: tier })}
                      onApprove={async ({ subscriptionID }) => {
                        try {
                          const r = await api("/api/public/subscriptions/confirm", { method: "POST", body: {
                            subscription_id: subscriptionID, display_name: ref.current.name, show_on_leaderboard: ref.current.showMe } });
                          setDone({ ...r, kind: "monthly", display: `$${r.amountUsd}` });
                          load();
                        } catch (e) { toast(e.message, "error"); }
                      }}
                      onError={(err) => toast(err?.message || "PayPal could not start. Please try again.", "error")}
                    />
                  </PayPalScriptProvider>
                ) : null}
              </div>
              <p className="mt-2 text-center text-xs text-slate-400">{t("donate.secure")}</p>
            </>
          )}
        </Card>

        {/* Recent + donor wall */}
        <Card className="order-4 lg:order-3 lg:col-span-8">
          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-navy-900">{t("donate.recent")}</h2>
                <Sparkles className="h-5 w-5 text-sun-400" />
              </div>
              <motion.ul variants={stagger} initial="hidden" animate="show" className="mt-4 space-y-2">
                {(stats?.recent || []).map((d, i) => (
                  <motion.li key={i} variants={rise} className="flex items-center gap-3 rounded-2xl bg-canvas p-3">
                    <span className="grid h-10 w-10 place-items-center rounded-full bg-white text-sm font-extrabold text-navy-900 ring-1 ring-slate-100">
                      {d.name === "Anonymous" ? "♥" : d.name[0]}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-navy-900">{d.name === "Anonymous" ? t("donate.anonymous") : d.name}</p>
                      <p className="text-xs text-slate-500">{timeAgo(d.at)}{d.monthly && " · ↻"}</p>
                    </div>
                    <span className="text-sm font-extrabold text-leaf-500">+{d.display}</span>
                  </motion.li>
                ))}
                {!stats && [1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}
              </motion.ul>
            </div>
            <div>
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-navy-900">{t("tr.wall")}</h2>
                <Trophy className="h-5 w-5 text-sun-400" />
              </div>
              <ol className="mt-4 space-y-2">
                {board.map((b, i) => (
                  <motion.li key={b.name + i} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.07 }}
                    className="flex items-center gap-3 rounded-2xl bg-canvas p-3">
                    <span className={`grid h-9 w-9 place-items-center rounded-full text-sm font-extrabold ${["bg-sun-400 text-navy-900", "bg-slate-300 text-navy-900", "bg-amber-600 text-white"][i] || "bg-white text-navy-900"}`}>{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-navy-900">{b.name} {b.monthly && <span className="ml-1 rounded-full bg-brand-100 px-1.5 text-[10px] text-brand-600">↻</span>}</p>
                      <p className="text-xs text-slate-500">{b.familiesHelped} {t(b.familiesHelped === 1 ? "tr.familyShort" : "tr.familiesShort")}</p>
                    </div>
                    <span className="text-sm font-extrabold text-navy-900">{money(b.totalUsd)}</span>
                  </motion.li>
                ))}
              </ol>
            </div>
          </div>
        </Card>
      </motion.div>

      {/* How it works */}
      <motion.section variants={stagger} initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.3 }} className="mt-10">
        <h2 className="text-2xl font-extrabold tracking-tight text-navy-900">{t("donate.how")}</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-4">
          {steps.map(({ icon: Icon, title, text }, i) => (
            <Card key={i} hover className="relative">
              <span className="absolute right-5 top-5 text-5xl font-extrabold text-slate-100">{i + 1}</span>
              <span className={`grid h-12 w-12 place-items-center rounded-2xl ${["bg-sun-400", "bg-brand-600 text-white", "bg-leaf-500 text-white", "bg-navy-900 text-white"][i]}`}>
                <Icon className="h-6 w-6" />
              </span>
              <h3 className="relative mt-4 font-bold text-navy-900">{title}</h3>
              <p className="relative mt-1 text-sm text-slate-500">{text}</p>
            </Card>
          ))}
        </div>
      </motion.section>

      <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
        className="card-wave mt-10 flex flex-col items-center justify-between gap-4 rounded-[32px] bg-navy-900 p-8 text-white md:flex-row">
        <div className="flex items-center gap-4">
          <HandCoins className="h-10 w-10 text-sun-400" />
          <div>
            <p className="text-xl font-extrabold">{t("donate.bannerTitle")}</p>
            <p className="text-sm text-white/70">{t("donate.bannerText")}</p>
          </div>
        </div>
        <Link to="/apply" className="rounded-full bg-sun-400 px-6 py-3 text-sm font-bold text-navy-900 hover:brightness-105">{t("donate.bannerCta")}</Link>
      </motion.div>
    </Page>
  );
}

function DoneBox({ done, t, onAgain }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(done.receipt); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* ignore */ }
  };
  return (
    <div className="relative grid place-items-center py-6 text-center">
      <Confetti fire />
      <SuccessCheck />
      <p className="mt-4 text-xl font-extrabold text-navy-900">
        {done.kind === "monthly" ? t("donate.monthlyThanks", { amount: done.display }) : t("donate.thanks", { amount: done.display })}
      </p>
      {done.status === "PENDING" && <p className="mt-1 text-sm text-amber-700">{t("donate.pending")}</p>}
      {done.receipt && (
        <>
          <p className="mt-4 text-xs font-bold uppercase tracking-wide text-slate-400">{t("donate.receipt")}</p>
          <button onClick={copy} className="mt-1 flex items-center gap-2 rounded-full bg-navy-900 px-5 py-2 font-mono text-lg font-bold tracking-widest text-white">
            {done.receipt} <Copy className={`h-4 w-4 ${copied ? "text-sun-400" : ""}`} />
          </button>
          <p className="mt-2 max-w-xs text-xs text-slate-500">{t("donate.followHint")}</p>
        </>
      )}
      <div className="mt-5 flex gap-2">
        <button onClick={onAgain} className="rounded-full bg-canvas px-5 py-2.5 text-sm font-semibold text-navy-900">{t("donate.again")}</button>
        <Link to={done.receipt ? `/transparency?receipt=${done.receipt}#follow` : "/transparency"}
          className="rounded-full bg-navy-900 px-5 py-2.5 text-sm font-semibold text-white">{t("donate.seeImpact")}</Link>
      </div>
    </div>
  );
}
