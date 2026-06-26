"use client";
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

declare global { interface Window { google?: any } }

/** Renders the official Google button only when the backend reports Google enabled. */
export function GoogleButton({ onToken }: { onToken: (idToken: string) => void }) {
  const { data } = useQuery({ queryKey: ["authConfig"], queryFn: api.authConfig, retry: false });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!data?.googleEnabled || !data.googleClientId || !ref.current) return;
    const init = () => {
      if (!window.google || !ref.current) return;
      window.google.accounts.id.initialize({ client_id: data.googleClientId, callback: (r: any) => onToken(r.credential) });
      window.google.accounts.id.renderButton(ref.current, { theme: "outline", size: "large", width: 332, text: "continue_with" });
    };
    if (window.google) { init(); return; }
    let s = document.getElementById("gis") as HTMLScriptElement | null;
    if (!s) { s = document.createElement("script"); s.id = "gis"; s.src = "https://accounts.google.com/gsi/client"; s.async = true; document.head.appendChild(s); }
    s.addEventListener("load", init);
    return () => s?.removeEventListener("load", init);
  }, [data, onToken]);

  if (!data?.googleEnabled) return null;
  return (
    <>
      <div className="auth-or"><span>or</span></div>
      <div ref={ref} style={{ display: "flex", justifyContent: "center" }} />
    </>
  );
}
