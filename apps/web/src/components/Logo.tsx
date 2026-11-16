import clsx from "clsx";
import { Link } from "react-router-dom";

/** The LifePilot mark: a gold navigation arrow on charcoal. `onDark` for the sidebar and dark sections. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={clsx("size-8 shrink-0", className)} aria-hidden>
      <rect width="32" height="32" rx="9" fill="#3b2418" />
      <rect x="0.5" y="0.5" width="31" height="31" rx="8.5" fill="none" stroke="#ffffff" strokeOpacity="0.08" />
      <path d="M9.5 22.5 L16 8 L22.5 22.5 L16 18.6 Z" fill="#8ec5ff" />
    </svg>
  );
}

export function Logo({ to = "/app", onDark = false, compact = false }: { to?: string; onDark?: boolean; compact?: boolean }) {
  return (
    <Link to={to} className={clsx("flex items-center gap-2.5 font-semibold tracking-tight", onDark ? "text-side-ink" : "text-ink")} aria-label="LifePilot AI home">
      <LogoMark />
      {!compact && (
        <span className="text-[17px]">
          LifePilot <span className={onDark ? "text-accent" : "text-accent-strong"}>AI</span>
        </span>
      )}
    </Link>
  );
}
