"use client";
import { Icon, EmptyState } from "./ui";

/** Placeholder for routes still being ported from the mockup. */
export function PageStub({ title, icon = "screwdriver-wrench" }: { title: string; icon?: string }) {
  return (
    <>
      <div className="breadcrumb-bar">
        <nav className="breadcrumb">
          <Icon name="folder" solid={false} />
          <span className="crumb-link">Dashboard</span>
          <Icon name="chevron-right" />
          <span className="crumb-cur">{title}</span>
        </nav>
      </div>
      <div className="page">
        <EmptyState icon={icon} title={`${title}`} hint="This screen is being ported from the mockup — coming in the next phase." />
      </div>
    </>
  );
}
