import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AnimatePresence, animate, motion, useInView } from "framer-motion";
import { AlertTriangle, CheckCircle2, Loader2, ShieldAlert, ShieldCheck, X } from "lucide-react";

export const spring = { type: "spring", stiffness: 260, damping: 26 };

export const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.05 } },
};
export const rise = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: spring },
};

export function Page({ children, className = "" }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function Card({ children, className = "", hover = false, ...rest }) {
  const bg = /(^|\s)bg-/.test(className) ? "" : "bg-white"; // let callers override the background
  return (
    <motion.div
      variants={rise}
      whileHover={hover ? { y: -3, boxShadow: "var(--shadow-lift)" } : undefined}
      className={`rounded-[28px] ${bg} p-5 shadow-[var(--shadow-card)] ${className}`}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

const BTN = {
  primary: "bg-navy-900 text-white hover:bg-navy-800",
  blue: "bg-brand-600 text-white hover:bg-brand-500",
  ghost: "bg-white text-navy-900 ring-1 ring-slate-200 hover:bg-slate-50",
  danger: "bg-coral-500 text-white hover:brightness-105",
  success: "bg-leaf-500 text-white hover:brightness-105",
  sun: "bg-sun-400 text-navy-900 hover:brightness-105",
};

export function Button({ variant = "primary", loading, icon: Icon, children, className = "", ...rest }) {
  return (
    <motion.button
      whileTap={{ scale: 0.96 }}
      whileHover={{ y: -1 }}
      disabled={loading || rest.disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${BTN[variant]} ${className}`}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : Icon && <Icon className="h-4 w-4" />}
      {children}
    </motion.button>
  );
}

export function AnimatedNumber({ value, prefix = "", suffix = "", decimals = 0, className = "" }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true });
  const prev = useRef(0);
  useEffect(() => {
    if (!inView || !ref.current) return;
    const controls = animate(prev.current, Number(value) || 0, {
      duration: 1.1,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => {
        if (ref.current)
          ref.current.textContent =
            prefix + v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + suffix;
      },
    });
    prev.current = Number(value) || 0;
    return () => controls.stop();
  }, [value, inView, prefix, suffix, decimals]);
  return <span ref={ref} className={className}>{prefix}0{suffix}</span>;
}

export function UrgencyRing({ score, size = 52 }) {
  const s = score ?? 0;
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  const color = s >= 80 ? "#f2665a" : s >= 55 ? "#f5a524" : s >= 30 ? "#3b74ff" : "#94a3b8";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} title={`Urgency ${s}/100`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#eef0f4" strokeWidth="5" fill="none" />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth="5" fill="none" strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c - (c * s) / 100 }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-sm font-bold text-navy-900">
        {score == null ? "–" : s}
      </span>
    </div>
  );
}

const RISK = {
  low: { cls: "bg-leaf-100 text-leaf-500", icon: ShieldCheck, label: "Low risk" },
  medium: { cls: "bg-sun-100 text-amber-700", icon: AlertTriangle, label: "Check" },
  high: { cls: "bg-coral-100 text-coral-500", icon: ShieldAlert, label: "High risk" },
};
export function RiskBadge({ risk = "low" }) {
  const r = RISK[risk] || RISK.low;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${r.cls}`}>
      <r.icon className="h-3.5 w-3.5" /> {r.label}
    </span>
  );
}

const STATUS = {
  PENDING: "bg-brand-100 text-brand-600",
  APPROVED: "bg-leaf-100 text-leaf-500",
  REJECTED: "bg-slate-100 text-slate-500",
  PAID: "bg-navy-900 text-white",
  COMPLETED: "bg-leaf-100 text-leaf-500",
  SUCCESS: "bg-leaf-100 text-leaf-500",
  UNCLAIMED: "bg-sun-100 text-amber-700",
  FAILED: "bg-coral-100 text-coral-500",
  CREATED: "bg-slate-100 text-slate-500",
};
export function StatusBadge({ status }) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS[status] || "bg-slate-100 text-slate-600"}`}>
      {status?.charAt(0) + status?.slice(1).toLowerCase()}
    </span>
  );
}

export function Skeleton({ className = "" }) {
  return <div className={`shimmer rounded-2xl ${className}`} />;
}

export function Field({ label, hint, error, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-navy-900">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs font-medium text-coral-500">{error}</span>}
    </label>
  );
}

export const inputCls =
  "w-full rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-sm text-navy-900 outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:bg-white focus:ring-4 focus:ring-brand-100";

// ---------- toasts ----------
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((text, kind = "ok") => {
    const id = Math.random().toString(36).slice(2);
    setItems((x) => [...x, { id, text, kind }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 4200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[100] flex w-80 flex-col gap-2">
        <AnimatePresence>
          {items.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, x: 40, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40, scale: 0.95 }}
              transition={spring}
              className={`pointer-events-auto flex items-start gap-3 rounded-2xl p-4 text-sm font-medium shadow-[var(--shadow-lift)] ${
                t.kind === "error" ? "bg-coral-500 text-white" : "bg-navy-900 text-white"
              }`}
            >
              {t.kind === "error" ? <AlertTriangle className="h-5 w-5 shrink-0" /> : <CheckCircle2 className="h-5 w-5 shrink-0 text-sun-400" />}
              <span className="flex-1">{t.text}</span>
              <button onClick={() => setItems((x) => x.filter((i) => i.id !== t.id))} aria-label="Dismiss">
                <X className="h-4 w-4 opacity-70" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

// ---------- modal ----------
export function Modal({ open, onClose, children, width = "max-w-lg" }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 grid place-items-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-navy-950/40 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            role="dialog" aria-modal="true"
            initial={{ opacity: 0, y: 30, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.97 }}
            transition={spring}
            className={`relative w-full ${width} rounded-[28px] bg-white p-6 shadow-[var(--shadow-lift)]`}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function SuccessCheck({ size = 72 }) {
  return (
    <motion.svg width={size} height={size} viewBox="0 0 72 72" initial="hidden" animate="show">
      <motion.circle cx="36" cy="36" r="32" fill="#ddf3ea"
        variants={{ hidden: { scale: 0 }, show: { scale: 1, transition: spring } }} style={{ originX: "36px", originY: "36px" }} />
      <motion.path d="M22 37l9 9 19-20" fill="none" stroke="#34a77f" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"
        variants={{ hidden: { pathLength: 0 }, show: { pathLength: 1, transition: { delay: 0.25, duration: 0.5 } } }} />
    </motion.svg>
  );
}

export function Confetti({ fire }) {
  const pieces = Array.from({ length: 28 });
  const colors = ["#facc4b", "#34a77f", "#3b74ff", "#f2665a", "#13235b"];
  return (
    <AnimatePresence>
      {fire && (
        <div className="pointer-events-none absolute inset-0 overflow-visible">
          {pieces.map((_, i) => {
            const angle = (i / pieces.length) * Math.PI * 2;
            const dist = 90 + (i % 5) * 22;
            return (
              <motion.span
                key={i}
                className="absolute left-1/2 top-1/2 h-2.5 w-1.5 rounded-sm"
                style={{ background: colors[i % colors.length] }}
                initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
                animate={{ x: Math.cos(angle) * dist, y: Math.sin(angle) * dist + 40, opacity: 0, rotate: 360 }}
                transition={{ duration: 1.3, ease: "easeOut" }}
              />
            );
          })}
        </div>
      )}
    </AnimatePresence>
  );
}

export function EmptyState({ icon: Icon, title, text }) {
  return (
    <div className="grid place-items-center rounded-3xl border-2 border-dashed border-slate-200 p-10 text-center">
      {Icon && <Icon className="mb-3 h-8 w-8 text-slate-300" />}
      <p className="font-semibold text-navy-900">{title}</p>
      {text && <p className="mt-1 max-w-sm text-sm text-slate-500">{text}</p>}
    </div>
  );
}
