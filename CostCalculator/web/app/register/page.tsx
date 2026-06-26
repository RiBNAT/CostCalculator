"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { AuthScaffold } from "@/components/AuthScaffold";
import { GoogleButton } from "@/components/GoogleButton";

export default function RegisterPage() {
  const { register, google, user, ready } = useAuth();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (ready && user) router.replace("/dashboard"); }, [ready, user, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr("");
    if (pw.length < 8) { setErr("Password must be at least 8 characters."); return; }
    setBusy(true);
    try { await register(name.trim(), email.trim(), pw); router.replace("/dashboard"); }
    catch (e: any) { setErr(e?.message || "Could not create account"); } finally { setBusy(false); }
  };
  const onGoogle = async (idToken: string) => { try { await google(idToken); router.replace("/dashboard"); } catch { setErr("Google sign-in failed"); } };

  return (
    <AuthScaffold>
      <div className="auth-card">
        <div className="auth-logo"><span className="auth-mark">৳</span><span className="auth-name"><b>Ribnat</b> <span>Cost</span></span></div>
        <h1 className="auth-title">Create your account</h1>
        <p className="auth-sub">Start tracking in minutes — free.</p>
        {err && <div className="auth-err">{err}</div>}
        <form onSubmit={submit}>
          <div className="ff"><label>Full name</label><input className="ob-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Tanbir Rahman" required /></div>
          <div className="ff"><label>Email</label><input className="ob-input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required /></div>
          <div className="ff"><label>Password</label><input className="ob-input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="At least 8 characters" required /></div>
          <button className="ob-btn ob-btn--primary auth-full" disabled={busy} style={{ marginTop: 4 }}>{busy ? "Creating…" : "Create account"}</button>
        </form>
        <GoogleButton onToken={onGoogle} />
        <p className="auth-foot">Already have an account? <Link className="auth-link" href="/login">Sign in</Link></p>
      </div>
    </AuthScaffold>
  );
}
