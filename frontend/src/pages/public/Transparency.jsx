import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Clock, Coins, HandHeart, Heart, MapPin, Search, ShieldX, Trophy, Wallet } from "lucide-react";
import { AnimatedNumber, Button, Card, Page, Skeleton, StatusBadge, inputCls, rise, stagger } from "../../components/ui";
import { FlowChart, PillBars } from "../../components/charts";
import ReliefMap from "../../components/ReliefMap";
import { api, money, timeAgo } from "../../lib/api";
import { useI18n } from "../../lib/i18n";

export default function Transparency() {
  const { t } = useI18n();
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => { api("/api/public/transparency").then(setData).catch((e) => setErr(e.message)); }, []);

  if (err) return <Page><p className="rounded-2xl bg-coral-100 p-4 text-coral-500">{err}</p></Page>;
  if (!data) return <Page className="grid gap-4 md:grid-cols-4">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-32" />)}<Skeleton className="h-72 md:col-span-4" /></Page>;

  const tiles = [
    { label: t("tr.donated"), value: data.raisedUsd, prefix: "$", icon: Wallet, cls: "bg-navy-900 text-white" },
    { label: t("tr.families"), value: data.familiesHelped, icon: HandHeart, cls: "bg-sun-400 text-navy-900" },
    { label: t("tr.hours"), value: data.avgHoursToAid ?? 0, decimals: 1, icon: Clock, cls: "bg-brand-600 text-white" },
    { label: t("tr.caught"), value: data.fraudBlocked, icon: ShieldX, cls: "bg-leaf-500 text-white" },
  ];
  const points = data.map.map((p) => ({
    key: p.town, lat: p.lat, lng: p.lng, radius: 8 + Math.min(p.requests, 10) * 2,
    color: p.paid ? "#34a77f" : "#3b74ff", title: p.town,
    lines: [`${p.requests} ${t("tr.requests")}`, `${p.paid} ${t("tr.paid")}`],
  }));

  return (
    <Page>
      <div className="mb-6">
        <h1 className="text-3xl font-extrabold tracking-tight text-navy-900 md:text-4xl">{t("tr.title")}</h1>
        <p className="mt-2 max-w-2xl text-slate-500">{t("tr.subtitle")}</p>
      </div>
      <motion.div variants={stagger} initial="hidden" animate="show" className="grid gap-4 md:grid-cols-4">
        {tiles.map(({ label, value, prefix, decimals, icon: Icon, cls }) => (
          <motion.div key={label} variants={rise} whileHover={{ y: -4 }} className={`card-wave rounded-[28px] p-5 shadow-[var(--shadow-card)] ${cls}`}>
            <Icon className="h-6 w-6 opacity-90" />
            <p className="mt-6 text-3xl font-extrabold tracking-tight"><AnimatedNumber value={value} prefix={prefix} decimals={decimals} /></p>
            <p className="text-sm font-medium opacity-80">{label}</p>
          </motion.div>
        ))}

        <FollowMyDollar t={t} />

        <Card className="md:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-lg font-bold text-navy-900"><Trophy className="h-5 w-5 text-sun-400" /> {t("tr.wall")}</h2>
            {data.currencies > 1 && <span className="flex items-center gap-1 rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-600"><Coins className="h-3.5 w-3.5" /> {t("tr.currencies", { n: data.currencies })}</span>}
          </div>
          <p className="mt-1 text-xs text-slate-500">{t("tr.wallText")}</p>
          <ol className="mt-4 space-y-2">
            {data.leaderboard.map((b, i) => (
              <motion.li key={b.name + i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                className="flex items-center gap-3 rounded-2xl bg-canvas p-3">
                <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-extrabold ${["bg-sun-400 text-navy-900", "bg-slate-300 text-navy-900", "bg-amber-600 text-white"][i] || "bg-white text-navy-900"}`}>{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-navy-900">
                    {b.name} {b.monthly && <span className="ml-1 rounded-full bg-brand-100 px-2 py-0.5 text-[10px] text-brand-600">{t("tr.monthlyBadge")}</span>}
                  </p>
                  <p className="truncate text-xs text-slate-500">{b.familiesHelped} {t(b.familiesHelped === 1 ? "tr.familyShort" : "tr.familiesShort")}{b.towns.length ? ` · ${b.towns.join(", ")}` : ""}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-extrabold text-navy-900">{money(b.totalUsd)}</p>
                  <div className="mt-1 flex justify-end gap-0.5">
                    {Array.from({ length: Math.min(b.familiesHelped, 8) }).map((_, k) => (
                      <motion.span key={k} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.3 + i * 0.05 + k * 0.04 }}>
                        <Heart className="h-3 w-3 fill-coral-500 text-coral-500" />
                      </motion.span>
                    ))}
                  </div>
                </div>
              </motion.li>
            ))}
          </ol>
        </Card>

        <Card className="md:col-span-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-navy-900">{t("tr.flow")}</h2>
            <span className="text-sm font-semibold text-slate-400">{t("tr.ready", { amount: money(data.availableUsd) })}</span>
          </div>
          <div className="mt-6"><FlowChart data={data.series} labels="date" height={210} /></div>
        </Card>

        <Card>
          <h2 className="text-lg font-bold text-navy-900">{t("tr.byTown")}</h2>
          {data.byLocation.length ? (
            <div className="mt-6"><PillBars items={data.byLocation.slice(0, 4).map((l) => ({ label: l.location, value: l.amount, display: `${l.families}` }))} height={200} /></div>
          ) : <p className="mt-6 text-sm text-slate-500">{t("tr.none")}</p>}
          <p className="mt-3 text-xs text-slate-400">{t("tr.barLabel")}</p>
        </Card>

        {points.length > 0 && (
          <Card className="md:col-span-4">
            <h2 className="text-lg font-bold text-navy-900">{t("tr.map")}</h2>
            <p className="mb-4 text-xs text-slate-500">{t("tr.mapText")}</p>
            <ReliefMap points={points} height={340} />
          </Card>
        )}

        <Card className="md:col-span-4">
          <h2 className="text-lg font-bold text-navy-900">{t("tr.latest")}</h2>
          <motion.ul variants={stagger} initial="hidden" animate="show" className="mt-4 grid gap-3 md:grid-cols-3">
            {data.recentPayouts.map((p, i) => (
              <motion.li key={i} variants={rise} className="flex items-center gap-3 rounded-2xl bg-canvas p-3">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-white text-brand-600 ring-1 ring-slate-100"><MapPin className="h-5 w-5" /></span>
                <div className="flex-1">
                  <p className="text-sm font-bold text-navy-900">{t("tr.aFamily", { town: p.location })}</p>
                  <p className="text-xs text-slate-500">{p.purpose && p.purpose !== "other" ? `${t(`need.${p.purpose}`)} · ` : ""}{timeAgo(p.at)}{p.method === "VENMO" && " · Venmo"}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-extrabold text-navy-900">{money(p.amount)}</p>
                  <StatusBadge status={p.status} />
                </div>
              </motion.li>
            ))}
          </motion.ul>
          {!data.recentPayouts.length && <p className="mt-4 text-sm text-slate-500">{t("tr.none")}</p>}
        </Card>
      </motion.div>
    </Page>
  );
}

function FollowMyDollar({ t }) {
  const [params] = useSearchParams();
  const [code, setCode] = useState(params.get("receipt") || "");
  const [res, setRes] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const find = async (c = code) => {
    if (!c.trim()) return;
    setErr(""); setLoading(true);
    try { setRes(await api(`/api/public/donations/receipt/${encodeURIComponent(c.trim().toUpperCase())}`)); }
    catch (e) { setErr(e.message); setRes(null); } finally { setLoading(false); }
  };
  useEffect(() => {
    if (params.get("receipt")) {
      find(params.get("receipt"));
      setTimeout(() => document.getElementById("follow")?.scrollIntoView({ behavior: "smooth" }), 400);
    }
  }, []); // eslint-disable-line

  return (
    <Card id="follow" className="card-wave h-fit scroll-mt-24 self-start bg-navy-900 text-white md:col-span-2">
      <h2 className="flex items-center gap-2 text-lg font-bold"><Search className="h-5 w-5 text-sun-400" /> {t("tr.follow")}</h2>
      <p className="mt-1 text-sm text-white/70">{t("tr.followText")}</p>
      <form onSubmit={(e) => { e.preventDefault(); find(); }} className="mt-4 flex gap-2 rounded-full bg-white p-1.5">
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder={t("tr.receiptPh")} maxLength={12}
          className="min-w-0 flex-1 rounded-full bg-transparent px-4 font-mono text-sm uppercase text-navy-900 outline-none" aria-label={t("tr.follow")} />
        <Button type="submit" variant="sun" loading={loading}>{t("tr.find")}</Button>
      </form>
      <p className="mt-2 text-xs text-white/50">Demo: try DN-DEMO01</p>
      {err && <p className="mt-3 rounded-2xl bg-coral-500/20 p-3 text-sm">{err}</p>}
      <AnimatePresence mode="wait">
        {res && (
          <motion.div key={res.receipt} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-4">
            <p className="text-2xl font-extrabold">
              {res.families === 1 ? t("tr.reached1", { amount: res.display }) : t("tr.reached", { amount: res.display, n: res.families })}
            </p>
            <p className="mt-2 rounded-2xl bg-white/10 p-3 text-sm italic text-white/90">“{res.note}”</p>
            <ul className="mt-3 space-y-1.5">
              {res.slices.map((s, i) => (
                <motion.li key={i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 + i * 0.08 }}
                  className="flex items-center justify-between rounded-2xl bg-white/10 px-3 py-2 text-sm">
                  <span className="flex items-center gap-2"><MapPin className="h-4 w-4 text-sun-400" />{t("tr.aFamily", { town: s.location })}</span>
                  <span className="font-bold">{money(s.amount, 2)} <span className="text-xs font-normal text-white/60">· {timeAgo(s.at)}</span></span>
                </motion.li>
              ))}
            </ul>
            {res.waitingUsd > 0.5 && <p className="mt-2 text-xs text-white/60">{t("tr.waiting", { amount: money(res.waitingUsd, 2) })}</p>}
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}
