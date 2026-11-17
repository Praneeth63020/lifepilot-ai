import clsx from "clsx";
import { Loader2, MoreHorizontal, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import type { Priority } from "@lifepilot/shared";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "dark";
type Size = "sm" | "md" | "lg";

/** Button styling, also for links that should look like buttons (never nest a <button> in an <a>). */
export function buttonClass({ variant = "secondary", size = "md", className }: { variant?: Variant; size?: Size; className?: string } = {}) {
  return clsx(
    "inline-flex items-center justify-center gap-1.5 rounded-xl font-medium transition-[background-color,color,box-shadow,opacity,translate,filter] disabled:pointer-events-none disabled:opacity-50",
    size === "sm" ? "h-8 px-3 text-sm" : size === "lg" ? "h-12 px-6 text-base" : "h-10 px-4 text-sm",
    variant === "primary" && "bg-accent font-semibold text-accent-ink ring-1 ring-inset ring-[#3b2418]/15 shadow-[inset_0_-2px_0_rgb(59_36_24/0.12),0_6px_16px_-8px_rgb(31_94_153/0.45)] hover:-translate-y-px hover:brightness-[1.04] active:translate-y-0",
    variant === "dark" && "bg-ink font-semibold text-canvas hover:opacity-90",
    variant === "secondary" && "border border-line bg-surface text-ink hover:bg-surface-2",
    variant === "ghost" && "text-muted hover:bg-surface-2 hover:text-ink",
    variant === "danger" && "border border-danger/40 text-danger hover:bg-danger/10",
    className,
  );
}

export function Button({
  variant = "secondary",
  size = "md",
  loading,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={buttonClass({ variant, size, className })}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

/** The base panel: white, rounded, subtle border and shadow. */
export const cardClass = "rounded-[var(--radius-card)] border border-line bg-surface shadow-card";

export function Card({
  title,
  icon,
  subtitle,
  action,
  children,
  className,
  id,
}: {
  title?: ReactNode;
  icon?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={clsx(cardClass, "p-4 sm:p-5", className)}>
      {(title || action) && (
        <header className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && (
              <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
                {icon && <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-surface-2 text-ink [&>svg]:size-4" aria-hidden>{icon}</span>}
                {title}
              </h2>
            )}
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

/** A headline number from real data, with an optional link to where it comes from. */
export function StatCard({ label, value, hint, icon, tone = "neutral", href, LinkComponent }: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: "neutral" | "accent" | "danger" | "violet" | "blue" | "ok";
  href?: string;
  LinkComponent?: (p: { to: string; className?: string; children: ReactNode }) => ReactNode;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-muted">{label}</p>
        {icon && (
          <span
            aria-hidden
            className={clsx(
              "grid size-9 shrink-0 place-items-center rounded-xl [&>svg]:size-[18px]",
              tone === "neutral" && "bg-surface-2 text-ink",
              tone === "accent" && "bg-accent text-accent-ink",
              tone === "danger" && "bg-danger/10 text-danger",
              tone === "violet" && "bg-violet/10 text-violet",
              tone === "blue" && "bg-blue/10 text-blue",
              tone === "ok" && "bg-ok/10 text-ok",
            )}
          >
            {icon}
          </span>
        )}
      </div>
      <p className="mt-3 font-display text-3xl font-semibold tracking-tight text-ink">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </>
  );
  const cls = clsx(cardClass, "block p-4 sm:p-5", href && "transition-shadow hover:shadow-pop");
  return href && LinkComponent ? <LinkComponent to={href} className={cls}>{body}</LinkComponent> : <div className={cls}>{body}</div>;
}

/** Horizontal progress bar with an accessible value. */
export function ProgressBar({ value, label, tone = "accent", className }: { value: number; label: string; tone?: "accent" | "ok" | "violet" | "blue" | "ink"; className?: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className={clsx("h-2 overflow-hidden rounded-full bg-surface-2", className)}>
      <div
        className={clsx(
          "h-full rounded-full transition-[width]",
          tone === "accent" && "bg-accent",
          tone === "ok" && "bg-ok",
          tone === "violet" && "bg-violet",
          tone === "blue" && "bg-blue",
          tone === "ink" && "bg-ink",
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** Initials avatar for the signed-in user. */
export function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return (
    <span aria-hidden className={clsx("grid size-9 shrink-0 place-items-center rounded-full bg-accent text-sm font-semibold text-accent-ink", className)}>
      {initials || "?"}
    </span>
  );
}

export function Badge({ children, tone = "neutral", className, title }: { children: ReactNode; tone?: "neutral" | "accent" | "danger" | "warn" | "ok" | "violet" | "blue"; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={clsx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        tone === "violet" && "bg-violet/10 text-violet",
        tone === "blue" && "bg-blue/10 text-blue",
        tone === "neutral" && "bg-surface-2 text-muted",
        tone === "accent" && "bg-accent-soft text-accent-strong",
        tone === "danger" && "bg-danger/10 text-danger",
        tone === "warn" && "bg-warn/15 text-warn",
        tone === "ok" && "bg-ok/15 text-ok",
        className,
      )}
    >
      {children}
    </span>
  );
}

const PRIORITY_TONE: Record<Priority, "danger" | "warn" | "blue" | "neutral"> = { urgent: "danger", high: "warn", medium: "blue", low: "neutral" };
export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <Badge tone={PRIORITY_TONE[priority]} title={`${priority} priority`}>
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {priority}
    </Badge>
  );
}

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      {icon && <div className="mb-1 grid size-12 place-items-center rounded-2xl bg-surface-2 text-ink [&>svg]:size-6">{icon}</div>}
      <p className="font-semibold">{title}</p>
      {children && <p className="max-w-sm text-sm text-muted">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 py-6 text-sm text-muted">
      <Loader2 className="size-4 animate-spin" aria-hidden /> {label}…
    </div>
  );
}

export function ErrorNote({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
      <span>{msg}</span>
      {onRetry && (
        <Button size="sm" variant="ghost" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: ReactNode; error?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-muted">{hint}</p>}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

const inputCls = "h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink placeholder:text-muted/70 focus:border-accent-strong focus:outline-none focus:ring-2 focus:ring-accent/30";
export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  // Like Select: a caller-provided width (w-auto, w-40, …) replaces the default full width.
  const sized = /(^|\s)w-/.test(className ?? "");
  return <input {...rest} className={clsx(inputCls.replace("w-full ", sized ? "" : "w-full "), className)} />;
}
export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  const sized = /(^|\s)w-/.test(className ?? "");
  return (
    <select {...rest} className={clsx(inputCls.replace("w-full ", sized ? "" : "w-full "), "pr-8", className)}>
      {children}
    </select>
  );
}
export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={clsx(inputCls, "h-auto min-h-20 py-2", className)} />;
}

export function Toggle({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: ReactNode; disabled?: boolean }) {
  return (
    <label className={clsx("flex items-start justify-between gap-4 py-2", disabled && "opacity-50")}>
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {description && <span className="block text-xs text-muted">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx("relative mt-0.5 h-6 w-10 shrink-0 rounded-full transition-colors", checked ? "bg-accent" : "bg-line")}
      >
        <span className={clsx("absolute top-0.5 size-5 rounded-full bg-white shadow transition-all", checked ? "left-[18px]" : "left-0.5")} />
      </button>
    </label>
  );
}

export function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  // Callers pass inline arrows; keep the latest in a ref so re-renders don't re-run the focus effect.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusables = () => [...(ref.current?.querySelectorAll<HTMLElement>("input,select,textarea,button,a[href]") ?? [])].filter((el) => !el.hasAttribute("disabled"));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
      if (e.key !== "Tab") return;
      // Keep keyboard focus inside the dialog.
      const els = focusables();
      if (!els.length) return;
      const first = els[0]!;
      const last = els[els.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    // Focus the first form field, not the header's Close button.
    (ref.current?.querySelector<HTMLElement>("input,select,textarea") ?? focusables()[0])?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      previouslyFocused?.focus?.();
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className="fade-in max-h-[90vh] w-full overflow-y-auto rounded-t-3xl border border-line bg-surface p-5 shadow-pop sm:max-w-lg sm:rounded-3xl sm:p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">{title}</h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </Button>
        </div>
        {children}
        {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: string; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-accent-strong">{eyebrow}</p>}
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-[28px]">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-3xl text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
}

/**
 * Compact "more actions" dropdown. Keyboard: Enter/Space/ArrowDown opens, arrows move,
 * Escape closes and returns focus to the trigger; clicking outside closes it.
 */
export function Menu({
  label,
  items,
  className,
  trigger,
  triggerClassName,
  header,
}: {
  label: string;
  items: MenuItem[];
  className?: string;
  /** Custom trigger content (default: a "…" icon). */
  trigger?: ReactNode;
  triggerClassName?: string;
  /** Non-interactive content shown above the items (e.g. the signed-in user). */
  header?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // Open upwards when there isn't room below the trigger (e.g. the last rows on a phone).
  const [up, setUp] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const itemEls = () => [...(rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];

  useEffect(() => {
    if (!open) return;
    itemEls()[0]?.focus();
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };
  const openMenu = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    const needed = items.length * 40 + 16;
    setUp(Boolean(rect && window.innerHeight - rect.bottom < needed && rect.top > needed));
    setOpen(true);
  };
  const onMenuKey = (e: ReactKeyboardEvent) => {
    const els = itemEls();
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      els[(i + 1) % els.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      els[(i - 1 + els.length) % els.length]?.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className={clsx("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            openMenu();
          }
        }}
        className={triggerClassName ?? buttonClass({ variant: "ghost", size: "sm" })}
      >
        {trigger ?? <MoreHorizontal className="size-4" aria-hidden />}
      </button>
      {open && (
        <div id={menuId} role="menu" aria-label={label} onKeyDown={onMenuKey} className={clsx("fade-in absolute right-0 z-30 min-w-48 rounded-xl border border-line bg-surface p-1 shadow-pop", up ? "bottom-full mb-1" : "top-full mt-1")}>
          {header && <div className="border-b border-line px-2.5 pb-2 pt-1.5">{header}</div>}
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                setOpen(false);
                it.onSelect();
              }}
              className={clsx(
                "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm focus:outline-none",
                it.danger ? "text-danger hover:bg-danger/10 focus:bg-danger/10" : "text-ink hover:bg-surface-2 focus:bg-surface-2",
              )}
            >
              {it.icon}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * WAI-ARIA tabs: arrow keys / Home / End move between tabs (and select them), only the selected
 * tab is in the Tab order, and each tab is linked to the panel it controls.
 */
export function useTabs<T extends string>(idPrefix: string, ids: readonly T[], value: T, onChange: (v: T) => void, orientation: "horizontal" | "vertical" = "horizontal") {
  const slug = (v: string) => `${idPrefix}-${v.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const select = (v: T) => {
    onChange(v);
    document.getElementById(`${slug(v)}-tab`)?.focus();
  };
  return {
    tabProps: (v: T) => ({
      id: `${slug(v)}-tab`,
      role: "tab" as const,
      "aria-selected": value === v,
      "aria-controls": `${idPrefix}-panel`,
      tabIndex: value === v ? 0 : -1,
      onClick: () => onChange(v),
      onKeyDown: (e: ReactKeyboardEvent) => {
        const i = ids.indexOf(v);
        // Both arrow pairs work, so a list that is vertical on desktop and horizontal on phones behaves either way.
        const forward = e.key === "ArrowRight" || (orientation === "vertical" && e.key === "ArrowDown");
        const back = e.key === "ArrowLeft" || (orientation === "vertical" && e.key === "ArrowUp");
        const next = forward ? ids[(i + 1) % ids.length] : back ? ids[(i - 1 + ids.length) % ids.length] : e.key === "Home" ? ids[0] : e.key === "End" ? ids[ids.length - 1] : undefined;
        if (next === undefined) return;
        e.preventDefault();
        select(next);
      },
    }),
    panelProps: { id: `${idPrefix}-panel`, role: "tabpanel" as const, "aria-labelledby": `${slug(value)}-tab` },
  };
}
