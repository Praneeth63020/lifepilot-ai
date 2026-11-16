import clsx from "clsx";
import type { ReactNode } from "react";
import { SampleTag } from "./site";

/**
 * Building blocks for the illustrative product mocks on the public site. Mocks are static pictures
 * of the UI built from markup: they contain no real buttons or form controls, so assistive tech
 * doesn't announce controls that do nothing.
 */

export type Tone = "accent" | "violet" | "blue" | "ok" | "warn" | "danger" | "neutral";

const chipTone: Record<Tone, string> = {
  accent: "bg-accent-soft text-accent-strong",
  violet: "bg-violet/10 text-violet",
  blue: "bg-blue/10 text-blue",
  ok: "bg-ok/15 text-ok",
  warn: "bg-warn/15 text-warn",
  danger: "bg-danger/10 text-danger",
  neutral: "bg-surface-2 text-muted",
};

export function Chip({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={clsx("inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium", chipTone[tone], className)}>{children}</span>;
}

export const barTone: Record<Tone, string> = {
  accent: "bg-accent",
  violet: "bg-violet",
  blue: "bg-blue",
  ok: "bg-ok",
  warn: "bg-warn",
  danger: "bg-danger",
  neutral: "bg-muted/40",
};

/** Looks like a button inside a mock; not focusable or announced as one. */
export function FakeButton({ variant = "secondary", children, className }: { variant?: "primary" | "secondary" | "dark" | "ghost"; children: ReactNode; className?: string }) {
  return (
    <span
      className={clsx(
        "inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-lg px-2.5 text-xs font-medium",
        variant === "primary" && "bg-accent font-semibold text-accent-ink",
        variant === "secondary" && "border border-line bg-surface text-ink",
        variant === "dark" && "bg-ink font-semibold text-canvas",
        variant === "ghost" && "text-muted",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A small panel inside a mock window. */
export function MockCard({ title, icon, aside, children, className }: { title?: ReactNode; icon?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={clsx("rounded-2xl border border-line bg-surface p-3.5", className)}>
      {(title || aside) && (
        <div className="mb-2.5 flex items-center justify-between gap-2">
          {title && (
            <p className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold text-ink">
              {icon && <span className="text-muted [&>svg]:size-3.5" aria-hidden>{icon}</span>}
              <span className="truncate">{title}</span>
            </p>
          )}
          {aside}
        </div>
      )}
      {children}
    </div>
  );
}

/**
 * A framed product mock: a charcoal title bar with a "sample data" tag and a light body.
 * Rendered as a <figure> so the whole thing is described once, with `label`.
 */
export function MockWindow({ label, title, children, className, bodyClassName, tag = "Sample data" }: { label: string; title: ReactNode; children: ReactNode; className?: string; bodyClassName?: string; tag?: ReactNode }) {
  return (
    <figure aria-label={label} className={clsx("m-0 overflow-hidden rounded-[24px] border border-line bg-surface-2 shadow-pop", className)}>
      <div className="flex items-center justify-between gap-3 bg-side px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex gap-1.5" aria-hidden>
            <span className="size-2.5 rounded-full bg-white/15" />
            <span className="size-2.5 rounded-full bg-white/15" />
            <span className="size-2.5 rounded-full bg-accent" />
          </span>
          <span className="truncate text-xs font-medium text-side-ink">{title}</span>
        </div>
        <SampleTag onDark>{tag}</SampleTag>
      </div>
      <div className={clsx("p-3 sm:p-4", bodyClassName)}>{children}</div>
    </figure>
  );
}
