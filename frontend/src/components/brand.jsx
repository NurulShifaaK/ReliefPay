// import { useState } from "react";
// import { motion } from "framer-motion";
// import { money } from "../lib/api";

// export function Logo({ light = false, className = "" }) {
//   return (
//     <span className={`flex items-center gap-2 ${className}`}>
//       <svg viewBox="0 0 64 64" className="h-8 w-8" aria-hidden>
//         <rect width="64" height="64" rx="18" fill={light ? "#ffffff" : "#13235B"} />
//         <path d="M32 47s-14-8.6-14-19a8 8 0 0 1 14-5.3A8 8 0 0 1 46 28c0 10.4-14 19-14 19z" fill="#FACC4B" />
//         <path d="M18 40c5 2 9 2 14 0s9-2 14 0" stroke="#34A77F" strokeWidth="4" fill="none" strokeLinecap="round" />
//       </svg>
//       <span className={`text-lg font-extrabold tracking-tight ${light ? "text-white" : "text-navy-900"}`}>
//         Relief<span className="text-brand-600">Pay</span>
//       </span>
//     </span>
//   );
// }

// const THEMES = {
//   sun: "bg-sun-400 text-navy-900",
//   blue: "bg-brand-600 text-white",
//   navy: "bg-navy-900 text-white",
//   leaf: "bg-leaf-500 text-white",
// };

// /** One wallet-style card. */
// export function FundCard({ theme = "navy", label, amount, footer, chip, className = "", style }) {
//   return (
//     <div className={`card-wave relative overflow-hidden rounded-3xl p-5 shadow-[var(--shadow-lift)] ${THEMES[theme]} ${className}`} style={style}>
//       <div className="flex items-start justify-between">
//         <span className="text-xs font-semibold uppercase tracking-wider opacity-80">{label}</span>
//         {chip && <span className="grid h-7 w-7 place-items-center rounded-full bg-white/25 text-xs">{chip}</span>}
//       </div>
//       <div className="mt-5 text-2xl font-extrabold tracking-tight">{money(amount)}</div>
//       {footer && <div className="mt-3 text-xs font-medium opacity-80">{footer}</div>}
//     </div>
//   );
// }

// /** Stack of fund cards that fans out on hover (like "Your cards" in the reference). */
// export function CardStack({ cards }) {
//   const [fan, setFan] = useState(false);
//   return (
//     <div className="relative h-[250px]" onMouseEnter={() => setFan(true)} onMouseLeave={() => setFan(false)}>
//       {cards.map((c, i) => (
//         <motion.div
//           key={c.label}
//           className="absolute inset-x-0"
//           style={{ zIndex: i + 1, top: i * 44 }}
//           initial={{ opacity: 0, y: 40 }}
//           animate={{ opacity: 1, y: fan ? i * 18 - 10 : 0, rotate: fan ? (i - 1) * 1.6 : 0 }}
//           transition={{ type: "spring", stiffness: 200, damping: 20, delay: fan ? 0 : i * 0.08 }}
//         >
//           <FundCard {...c} className={i < cards.length - 1 ? "pb-12" : ""} />
//         </motion.div>
//       ))}
//     </div>
//   );
// }

// /** Floating tilted cards for the hero (decorative). */
// export function HeroCards() {
//   return (
//     <div className="relative h-44 w-60 md:h-52 md:w-64" aria-hidden>
//       {[
//         { cls: "bg-leaf-500", rot: -14, x: -10, y: 18, d: 0 },
//         { cls: "bg-brand-600", rot: -4, x: 18, y: 4, d: 0.15 },
//       ].map((c, i) => (
//         <motion.div
//           key={i}
//           className={`card-wave absolute h-36 w-52 rounded-3xl p-4 text-white shadow-[var(--shadow-lift)] ${c.cls}`}
//           initial={{ opacity: 0, rotate: c.rot - 10, x: c.x + 40 }}
//           animate={{ opacity: 1, rotate: c.rot, x: c.x, y: [c.y, c.y - 8, c.y] }}
//           transition={{
//             opacity: { delay: c.d }, rotate: { delay: c.d, type: "spring" }, x: { delay: c.d, type: "spring" },
//             y: { duration: 5 + i, repeat: Infinity, ease: "easeInOut" },
//           }}
//         >
//           <div className="flex justify-between text-xs font-semibold opacity-90">
//             <span>{i ? "AID CARD" : "RELIEF"}</span><span className="italic font-extrabold">RP</span>
//           </div>
//           <div className="mt-8 font-mono text-sm tracking-widest opacity-90">•••• •••• {i ? "2048" : "7316"}</div>
//           <div className="mt-2 text-[11px] opacity-80">Sent in hours, not weeks</div>
//         </motion.div>
//       ))}
//     </div>
//   );
// }



import { useState } from "react";
import { motion } from "framer-motion";
import { money } from "../lib/api";

export function Logo({ light = false, className = "" }) {
  return (
    <span className={`flex items-center gap-2 ${className}`}>
      <img src="/logo.png" alt="" className="h-8 w-8 rounded-[9px]" width="32" height="32" />
      <span className={`text-lg font-extrabold tracking-tight ${light ? "text-white" : "text-navy-900"}`}>
        Relief<span className="text-brand-600">Pay</span>
      </span>
    </span>
  );
}

const THEMES = {
  sun: "bg-sun-400 text-navy-900",
  blue: "bg-brand-600 text-white",
  navy: "bg-navy-900 text-white",
  leaf: "bg-leaf-500 text-white",
};

/** One wallet-style card. */
export function FundCard({ theme = "navy", label, amount, footer, chip, className = "", style }) {
  return (
    <div className={`card-wave relative overflow-hidden rounded-3xl p-5 shadow-[var(--shadow-lift)] ${THEMES[theme]} ${className}`} style={style}>
      <div className="flex items-start justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider opacity-80">{label}</span>
        {chip && <span className="grid h-7 w-7 place-items-center rounded-full bg-white/25 text-xs">{chip}</span>}
      </div>
      <div className="mt-5 text-2xl font-extrabold tracking-tight">{money(amount)}</div>
      {footer && <div className="mt-3 text-xs font-medium opacity-80">{footer}</div>}
    </div>
  );
}

/** Stack of fund cards that fans out on hover (like "Your cards" in the reference). */
export function CardStack({ cards }) {
  const [fan, setFan] = useState(false);
  return (
    <div className="relative h-[250px]" onMouseEnter={() => setFan(true)} onMouseLeave={() => setFan(false)}>
      {cards.map((c, i) => (
        <motion.div
          key={c.label}
          className="absolute inset-x-0"
          style={{ zIndex: i + 1, top: i * 44 }}
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: fan ? i * 18 - 10 : 0, rotate: fan ? (i - 1) * 1.6 : 0 }}
          transition={{ type: "spring", stiffness: 200, damping: 20, delay: fan ? 0 : i * 0.08 }}
        >
          <FundCard {...c} className={i < cards.length - 1 ? "pb-12" : ""} />
        </motion.div>
      ))}
    </div>
  );
}

/** Floating tilted cards for the hero (decorative). */
export function HeroCards() {
  return (
    <div className="relative h-44 w-60 md:h-52 md:w-64" aria-hidden>
      {[
        { cls: "bg-leaf-500", rot: -14, x: -10, y: 18, d: 0 },
        { cls: "bg-brand-600", rot: -4, x: 18, y: 4, d: 0.15 },
      ].map((c, i) => (
        <motion.div
          key={i}
          className={`card-wave absolute h-36 w-52 rounded-3xl p-4 text-white shadow-[var(--shadow-lift)] ${c.cls}`}
          initial={{ opacity: 0, rotate: c.rot - 10, x: c.x + 40 }}
          animate={{ opacity: 1, rotate: c.rot, x: c.x, y: [c.y, c.y - 8, c.y] }}
          transition={{
            opacity: { delay: c.d }, rotate: { delay: c.d, type: "spring" }, x: { delay: c.d, type: "spring" },
            y: { duration: 5 + i, repeat: Infinity, ease: "easeInOut" },
          }}
        >
          <div className="flex justify-between text-xs font-semibold opacity-90">
            <span>{i ? "AID CARD" : "RELIEF"}</span><span className="italic font-extrabold">RP</span>
          </div>
          <div className="mt-8 font-mono text-sm tracking-widest opacity-90">•••• •••• {i ? "2048" : "7316"}</div>
          <div className="mt-2 text-[11px] opacity-80">Sent in hours, not weeks</div>
        </motion.div>
      ))}
    </div>
  );
}
