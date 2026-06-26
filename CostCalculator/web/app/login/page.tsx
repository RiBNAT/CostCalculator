"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/lib/toast";
import { AuthScaffold } from "@/components/AuthScaffold";
import { GoogleButton } from "@/components/GoogleButton";

export default function LoginPage() {
  const { login, google, user, ready } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (ready && user) router.replace("/dashboard"); }, [ready, user, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(""); setBusy(true);
    try { await login(email.trim(), pw); router.replace("/dashboard"); }
    catch (e: any) { setErr(e?.message || "Sign in failed"); } finally { setBusy(false); }
  };
  const onGoogle = async (idToken: string) => {
    try { await google(idToken); router.replace("/dashboard"); } catch { setErr("Google sign-in failed"); }
  };

  return (
    <AuthScaffold>
      <div className="auth-card">
        <div className="auth-logo"><span className="auth-mark">৳</span><span className="auth-name"><b>Ribnat</b> <span>Cost</span></span></div>
        <h1 className="auth-title">Welcome back</h1>
        <p className="auth-sub">Sign in to your dashboard.</p>
        {err && <div className="auth-err">{err}</div>}
        <form onSubmit={submit}>
          <div className="ff"><label>Email</label><input className="ob-input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
          <div className="ff"><label>Password</label><input className="ob-input" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required /></div>
          <div className="auth-row">
            <label className="auth-check"><input type="checkbox" defaultChecked /> Remember me</label>
            <button type="button" className="auth-link" onClick={() => toast("Password reset isn’t available yet — contact support.")}>Forgot password?</button>
          </div>
          <button className="ob-btn ob-btn--primary auth-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        </form>
        <GoogleButton onToken={onGoogle} />
        <p className="auth-foot">New to Ribnat? <Link className="auth-link" href="/register">Create an account</Link></p>
      </div>
    </AuthScaffold>
  );
}
