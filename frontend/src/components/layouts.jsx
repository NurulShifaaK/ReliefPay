import { createContext, useContext, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate, Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  Bot, HandCoins, HeartHandshake, LayoutDashboard, LifeBuoy, LogOut, Menu, Radar, ScrollText,
  SearchCheck, ShieldCheck, Users, X,
} from "lucide-react";
import { Logo } from "./brand";
import { api, initials } from "../lib/api";
import { LANGS, useI18n } from "../lib/i18n";
import { Languages } from "lucide-react";

function PillNav({ items, layoutId }) {
  return (
    <nav className="flex items-center gap-1 rounded-full bg-white p-1 shadow-[var(--shadow-card)]">
      {items.map(({ to, label, icon: Icon, end }) => (
        <NavLink key={to} to={to} end={end} className="relative rounded-full px-4 py-2 text-sm font-semibold">
          {({ isActive }) => (
            <>
              {isActive && (
                <motion.span layoutId={layoutId} className="absolute inset-0 rounded-full bg-navy-900"
                  transition={{ type: "spring", stiffness: 380, damping: 32 }} />
              )}
              <span className={`relative flex items-center gap-2 transition-colors ${isActive ? "text-white" : "text-slate-600 hover:text-navy-900"}`}>
                <Icon className="h-4 w-4" /> {label}
              </span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

// ---------------- Public ----------------
const PUBLIC_NAV = [
  { to: "/", key: "nav.donate", icon: HeartHandshake, end: true },
  { to: "/apply", key: "nav.help", icon: LifeBuoy },
  { to: "/track", key: "nav.track", icon: SearchCheck },
  { to: "/transparency", key: "nav.transparency", icon: Radar },
];

function LanguageSwitcher() {
  const { lang, setLang } = useI18n();
  return (
    <label className="flex items-center gap-1.5 rounded-full bg-white py-1.5 pl-3 pr-2 text-sm font-semibold text-navy-900 shadow-[var(--shadow-card)]">
      <Languages className="h-4 w-4 text-brand-600" aria-hidden />
      <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Language"
        className="cursor-pointer bg-transparent pr-1 outline-none">
        {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
      </select>
    </label>
  );
}

export function PublicLayout() {
  const location = useLocation();
  const { t } = useI18n();
  const nav = PUBLIC_NAV.map((n) => ({ ...n, label: t(n.key) }));
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [location.pathname]);
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 bg-canvas/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1760px] items-center justify-between gap-4 px-4 py-4 md:px-8 2xl:px-10">
          <Link to="/"><Logo /></Link>
          <div className="hidden lg:block"><PillNav items={nav} layoutId="public-pill" /></div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <Link to="/staff" className="hidden rounded-full bg-white px-4 py-2 text-sm font-semibold text-navy-900 shadow-[var(--shadow-card)] hover:bg-slate-50 lg:block">
              {t("nav.staff")}
            </Link>
          </div>
          <button className="rounded-full bg-white p-2 shadow-[var(--shadow-card)] lg:hidden" onClick={() => setOpen(!open)} aria-label="Menu">
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
        <AnimatePresence>
          {open && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden px-4 pb-4 md:px-8 lg:hidden">
              <div className="grid gap-2 rounded-3xl bg-white p-3 shadow-[var(--shadow-card)]">
                {[...nav, { to: "/staff", label: t("nav.staff"), icon: ShieldCheck }].map(({ to, label, icon: Icon }) => (
                  <NavLink key={to} to={to} end className={({ isActive }) =>
                    `flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold ${isActive ? "bg-navy-900 text-white" : "text-navy-900"}`}>
                    <Icon className="h-4 w-4" /> {label}
                  </NavLink>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>
      <main className="mx-auto max-w-[1760px] px-4 pb-16 md:px-8 2xl:px-10">
        <AnimatePresence mode="wait">
          <motion.div key={location.pathname}><Outlet /></motion.div>
        </AnimatePresence>
      </main>
      <footer className="mx-auto max-w-[1760px] px-4 pb-10 md:px-8 2xl:px-10 text-center text-xs text-slate-500">
        {t("footer")}
      </footer>
    </div>
  );
}

// ---------------- Staff ----------------
const AuthCtx = createContext(null);
export const useStaff = () => useContext(AuthCtx);

const STAFF_NAV = [
  { to: "/staff", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/staff/applications", label: "Applications", icon: Users },
  { to: "/staff/agent", label: "Payout Agent", icon: Bot },
  { to: "/staff/donations", label: "Donations", icon: HandCoins },
];

export function StaffLayout() {
  const [user, setUser] = useState(undefined);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    api("/api/staff/auth/me").then(setUser).catch(() => navigate("/staff/login", { replace: true }));
  }, [navigate]);

  const logout = async () => {
    await api("/api/staff/auth/logout", { method: "POST" }).catch(() => {});
    navigate("/staff/login");
  };

  if (!user) {
    return <div className="grid min-h-screen place-items-center"><Logo className="animate-pulse" /></div>;
  }

  const nav = user.role === "admin" ? [...STAFF_NAV, { to: "/staff/audit", label: "Audit", icon: ScrollText }] : STAFF_NAV;

  return (
    <AuthCtx.Provider value={user}>
      <div className="min-h-screen p-3 md:p-5">
        <div className="mx-auto flex max-w-[1760px] overflow-hidden rounded-[36px] bg-white/60 shadow-[var(--shadow-card)] ring-1 ring-white">
          {/* Icon rail */}
          <aside className="hidden w-20 shrink-0 flex-col items-center gap-3 border-r border-slate-100 bg-white py-6 lg:flex">
            {nav.map(({ to, icon: Icon, label, end }) => (
              <NavLink key={to} to={to} end={end} title={label} className="relative">
                {({ isActive }) => (
                  <>
                    {isActive && <motion.span layoutId="rail-dot" className="absolute -left-[22px] top-1/2 h-6 w-1.5 -translate-y-1/2 rounded-r-full bg-navy-900" />}
                    <motion.span whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.94 }}
                      className={`grid h-12 w-12 place-items-center rounded-full transition-colors ${isActive ? "bg-navy-900 text-white ring-4 ring-brand-100" : "bg-slate-100 text-navy-900 hover:bg-slate-200"}`}>
                      <Icon className="h-5 w-5" />
                    </motion.span>
                  </>
                )}
              </NavLink>
            ))}
            <div className="flex-1" />
            <button onClick={logout} title="Sign out" className="grid h-12 w-12 place-items-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-coral-500">
              <LogOut className="h-5 w-5" />
            </button>
          </aside>

          <div className="min-w-0 flex-1 bg-canvas/60">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-white px-5 py-4">
              <Link to="/staff"><Logo /></Link>
              <div className="order-3 w-full overflow-x-auto scrollbar-thin md:order-none md:w-auto">
                <PillNav items={nav} layoutId="staff-pill" />
              </div>
              <div className="flex items-center gap-3">
                <div className="hidden text-right sm:block">
                  <div className="text-sm font-bold text-navy-900">{user.name}</div>
                  <div className="text-xs capitalize text-slate-500">{user.role}</div>
                </div>
                <div className="grid h-10 w-10 place-items-center rounded-full bg-sun-400 text-sm font-extrabold text-navy-900 ring-4 ring-sun-100">
                  {initials(user.name)}
                </div>
                <button onClick={logout} className="rounded-full p-2 text-slate-500 hover:bg-slate-100 lg:hidden" aria-label="Sign out">
                  <LogOut className="h-5 w-5" />
                </button>
              </div>
            </header>
            <main className="p-4 md:p-6">
              <AnimatePresence mode="wait">
                <motion.div key={location.pathname}><Outlet /></motion.div>
              </AnimatePresence>
            </main>
          </div>
        </div>
      </div>
    </AuthCtx.Provider>
  );
}
