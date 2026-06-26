"use client";
import { Icon } from "./ui";

export function AuthScaffold({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth">
      <div className="auth__brand">
        <div className="b-logo"><span className="m">৳</span> Ribnat Cost</div>
        <h2>Your salary-cycle money, finally clear.</h2>
        <ul>
          <li><Icon name="calendar-check" /> Budget by pay cycle, not the calendar month</li>
          <li><Icon name="wallet" /> Cash, bKash, Nagad &amp; bank in one place</li>
          <li><Icon name="gauge-high" /> Know what&apos;s safe to spend, every day</li>
        </ul>
        <div className="trust"><Icon name="lock" /> Bank-level encryption · secure JWT sessions</div>
      </div>
      <div className="auth__main">{children}</div>
    </div>
  );
}
