import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Eye, EyeOff, Gavel, LogIn, ShieldCheck } from "lucide-react";
import { Button, Field, inputCls } from "../../components/ui";
import { FundCard, Logo } from "../../components/brand";
import { api } from "../../lib/api";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [judge, setJudge] = useState(false);
  const navigate = useNavigate();
  useEffect(() => { api("/api/public/config").then((c) => setJudge(!!c.judgeDemo)).catch(() => {}); }, []);

  const judgeLogin = async () => {
    setErr(""); setLoading(true);
    try { await api("/api/staff/auth/demo", { method: "POST" }); navigate("/staff?tour=1"); }
    catch (e2) { setErr(e2.message); } finally { setLoading(false); }
  };

  const submit = async (e) => {
    e.preventDefault();
    setErr(""); setLoading(true);
    try {
      await api("/api/staff/auth/login", { method: "POST", body: { email, password } });
      navigate("/staff");
    } catch (e2) { setErr(e2.message); } finally { setLoading(false); }
  };

  return (
    <div className="grid min-h-screen place-items-center p-4">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 200, damping: 24 }}
        className="grid w-full max-w-4xl overflow-hidden rounded-[36px] bg-white shadow-[var(--shadow-lift)] md:grid-cols-2">
        <div className="card-wave relative hidden flex-col justify-between bg-navy-900 p-10 text-white md:flex">
          <Logo light />
          <div className="relative h-80">
            {[
              { theme: "sun", label: "Raised", amount: 6250, rot: -6, y: 0 },
              { theme: "blue", label: "Ready to send", amount: 3810, rot: 3, y: 95 },
              { theme: "leaf", label: "Sent today", amount: 1240, rot: -2, y: 190 },
            ].map((c, i) => (
              <motion.div key={c.label} className="absolute w-64" style={{ left: 20 + i * 18 }}
                initial={{ opacity: 0, y: c.y + 60, rotate: 0 }} animate={{ opacity: 1, y: c.y, rotate: c.rot }}
                transition={{ delay: 0.2 + i * 0.12, type: "spring", stiffness: 150, damping: 16 }}>
                <FundCard theme={c.theme} label={c.label} amount={c.amount} />
              </motion.div>
            ))}
          </div>
          <p className="text-sm text-white/70">AI sorts the requests. People make the decisions. PayPal moves the money.</p>
        </div>

        <form onSubmit={submit} className="flex flex-col justify-center gap-5 p-8 md:p-12">
          <div className="md:hidden"><Logo /></div>
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-100 px-3 py-1 text-xs font-bold text-brand-600"><ShieldCheck className="h-3.5 w-3.5" /> Staff only</span>
            <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-navy-900">Welcome back</h1>
            <p className="mt-1 text-sm text-slate-500">Sign in with the staff account from your .env file.</p>
          </div>
          <Field label="Email">
            <input className={inputCls} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Password">
            <div className="relative">
              <input className={`${inputCls} pr-12`} type={show ? "text" : "password"} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              <button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400" aria-label="Show password">
                {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          </Field>
          {err && <motion.p initial={{ x: -8 }} animate={{ x: [8, -6, 4, 0] }} className="rounded-2xl bg-coral-100 p-3 text-sm font-medium text-coral-500">{err}</motion.p>}
          <Button type="submit" icon={LogIn} loading={loading} className="py-3">Sign in</Button>
          {judge && (
            <>
              <div className="flex items-center gap-3 text-xs font-semibold text-slate-400"><span className="h-px flex-1 bg-slate-200" />or<span className="h-px flex-1 bg-slate-200" /></div>
              <Button type="button" variant="sun" icon={Gavel} disabled={loading} onClick={judgeLogin} className="py-3">Try it as a judge</Button>
              <p className="-mt-2 text-center text-xs text-slate-400">One click, no password. Reviewer access: you can explore everything but cannot send money.</p>
            </>
          )}
          <Link to="/" className="text-center text-sm font-semibold text-slate-400 hover:text-navy-900">← Back to public site</Link>
        </form>
      </motion.div>
    </div>
  );
}
