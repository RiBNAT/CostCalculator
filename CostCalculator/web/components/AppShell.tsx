"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { usePeriods } from "@/lib/period";
import { taka } from "@/lib/money";
import { accountIcon, fmtRange } from "@/lib/format";
import { Icon, Dropdown } from "./ui";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: "gauge" },
  { href: "/expenses", label: "Expenses", icon: "receipt" },
  { href: "/transfers", label: "Transfers", icon: "right-left" },
  { href: "/budget", label: "Budget", icon: "chart-pie" },
  { href: "/insights", label: "Insights", icon: "chart-simple" },
  { href: "/lends", label: "Lends", icon: "handshake" },
  { href: "/savings", label: "Savings", icon: "piggy-bank" },
  { href: "/planner", label: "Planner", icon: "calendar-check" },
];
const BOTTOM = ["/dashboard", "/expenses", "/budget", "/insights", "/savings"];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const { periods, selected, select } = usePeriods();
  const [dark, setDark] = useState(false);
  const [showDetails, setShowDetails] = useState(true);

  useEffect(() => { setDark(document.documentElement.getAttribute("data-theme") === "dark"); }, []);
  const toggleTheme = () => {
    const next = dark ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("ribnat.theme", next); } catch {}
    setDark(!dark);
  };

  const { data: summary } = useQuery({
    queryKey: ["summary", selected?.id], queryFn: () => api.periodSummary(selected!.id), enabled: !!selected,
  });

  const initials = (user?.name || "?").split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  const isActive = (href: string) => path === href || path.startsWith(href + "/");

  return (
    <div className="itp-shell">
      <header className="itp-header">
        <div className="itp-header__left">
          <Link href="/dashboard" className="applauncher" aria-label="Home"><span className="brandmark">৳</span></Link>
          <span className="wordmark"><b>Ribnat</b> <span>Cost</span></span>
        </div>

        <nav className="itp-header__nav" aria-label="Main navigation">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={`navtab${isActive(n.href) ? " active" : ""}`}>{n.label}</Link>
          ))}
        </nav>

        <div className="itp-header__right">
          <button className="toolicon" onClick={toggleTheme} aria-label="Toggle theme"><Icon name={dark ? "sun" : "moon"} /></button>
          <button className="toolicon" onClick={() => setShowDetails((s) => !s)} aria-label="Details"><Icon name="circle-info" /></button>

          <Dropdown align="right" width={240} trigger={(open, toggle) => (
            <button className="period-pill" onClick={toggle} aria-expanded={open}>
              <Icon name="calendar" />
              <span>{selected?.name ?? "No period"}</span>
              {selected && <span className="muted">· {selected.status}</span>}
              <Icon name="angle-down" style={{ fontSize: 12, color: "var(--standard-600)" }} />
            </button>
          )}>
            {(close) => (
              <>
                <div className="ob-pop__head">Period</div>
                {periods.length === 0 && <div className="ob-note">No periods yet.</div>}
                {periods.map((p) => (
                  <button key={p.id} className="ob-menu__item" onClick={() => { select(p.id); close(); }}>
                    <Icon name="calendar" /><span>{p.name}</span><small>{p.status}</small>
                  </button>
                ))}
                <div className="ob-menu__divider" />
                <button className="ob-menu__item" onClick={() => { close(); router.push("/settings"); }}>
                  <Icon name="gear" /><span>Manage periods…</span>
                </button>
              </>
            )}
          </Dropdown>

          <Dropdown align="right" width={240} trigger={(open, toggle) => (
            <button className="avatar" onClick={toggle} aria-label="Account menu">{initials}</button>
          )}>
            {(close) => (
              <>
                <div className="ob-pop__head">{user?.name}</div>
                <button className="ob-menu__item" onClick={() => { close(); router.push("/settings"); }}><Icon name="gear" /><span>Settings</span></button>
                <button className="ob-menu__item" onClick={() => { close(); router.push("/import"); }}><Icon name="file-import" /><span>Import / Export</span></button>
                <div className="ob-menu__divider" />
                <button className="ob-menu__item" onClick={() => { close(); logout(); }}><Icon name="arrow-right-from-bracket" /><span>Sign out</span></button>
              </>
            )}
          </Dropdown>
        </div>
      </header>

      <div className="itp-body">
        <main className="itp-content">{children}</main>

        {showDetails && (
          <aside className="itp-sidebar">
            <div className="sidebar__header">
              <h2>Details</h2>
              <button className="close" onClick={() => setShowDetails(false)} aria-label="Close details"><Icon name="xmark" /></button>
            </div>
            <div className="sidebar__content">
              {selected ? (
                <>
                  <div className="sidebar-section-title">Period · {selected.name}</div>
                  <div className="kv"><span className="k">Cycle</span><span className="v num">{fmtRange(selected.startDate, selected.endDate)}</span></div>
                  <div className="kv"><span className="k">Status</span><span className="v"><span className={`ob-badge ob-badge--sm ob-badge--${selected.status === "open" ? "green" : "neutral"}`}>{selected.status}</span></span></div>
                  {summary && <>
                    <div className="kv"><span className="k">In hand</span><span className="v num">{taka(summary.inHand)}</span></div>
                    <div className="sidebar-section-title">Accounts</div>
                    {summary.accounts.filter((a) => a.account.kind !== "virtual").map((a) => (
                      <div className="kv" key={a.account.id}><span className="k"><Icon name={accountIcon(a.account.kind)} className="muted" /> {a.account.name}</span><span className="v num">{taka(a.current)}</span></div>
                    ))}
                  </>}
                </>
              ) : <div className="ob-note">Select or create a period to see details.</div>}
            </div>
          </aside>
        )}
      </div>

      <nav className="bottom-nav" aria-label="Primary">
        {NAV.filter((n) => BOTTOM.includes(n.href)).map((n) => (
          <Link key={n.href} href={n.href} className={`bnav-link${isActive(n.href) ? " active" : ""}`}>
            <Icon name={n.href === "/dashboard" ? "gauge" : n.icon} /><span>{n.href === "/dashboard" ? "Home" : n.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
