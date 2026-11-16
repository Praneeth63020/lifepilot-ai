import clsx from "clsx";
import { ArrowRight, Eye, Menu as MenuIcon, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useSession } from "../../session";
import { Logo } from "../Logo";
import { buttonClass } from "../ui";

/** Sections of the landing page, in page order. */
export const NAV_LINKS = [
  { id: "top", label: "Home" },
  { id: "features", label: "Features" },
  { id: "how-it-works", label: "How it works" },
  { id: "pricing", label: "Pricing" },
  { id: "about", label: "About" },
  { id: "faq", label: "FAQ" },
] as const;

/** Smoothly scrolls to a landing-page section (instantly with reduced motion) and moves focus there. */
export function scrollToSection(id: string): boolean {
  const el = id === "top" ? document.getElementById("top") : document.getElementById(id);
  if (!el) return false;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (id === "top") window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  else el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  el.focus({ preventScroll: true });
  window.history.replaceState(window.history.state, "", id === "top" ? window.location.pathname : `#${id}`);
  return true;
}

/** A link to a landing-page section: an in-page smooth-scroll anchor on "/", a route link elsewhere. */
export function SectionLink({ id, className, children, onNavigate }: { id: string; className?: string; children: ReactNode; onNavigate?: () => void }) {
  const { pathname } = useLocation();
  if (pathname !== "/") {
    return (
      <Link to={id === "top" ? "/" : `/#${id}`} className={className} onClick={onNavigate}>
        {children}
      </Link>
    );
  }
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    if (!document.getElementById(id)) return;
    e.preventDefault();
    // Close the mobile menu first: it sits in the sticky header, so closing it shifts the page.
    onNavigate?.();
    requestAnimationFrame(() => requestAnimationFrame(() => scrollToSection(id)));
  };
  return (
    <a href={id === "top" ? "#top" : `#${id}`} className={className} onClick={onClick}>
      {children}
    </a>
  );
}

/** Page-width container used by every marketing section. */
export function Container({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={clsx("mx-auto w-full px-4 sm:px-6 lg:px-10 2xl:px-[100px]", className)}>{children}</div>;
}

export function Eyebrow({ children, onDark = false, className }: { children: ReactNode; onDark?: boolean; className?: string }) {
  return (
    <p className={clsx("text-xs font-semibold uppercase tracking-[0.16em]", onDark ? "text-accent" : "text-accent-strong", className)}>{children}</p>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  lead,
  onDark = false,
  align = "left",
  id,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  lead?: ReactNode;
  onDark?: boolean;
  align?: "left" | "center";
  id?: string;
  className?: string;
}) {
  return (
    <div className={clsx(align === "center" && "mx-auto text-center", "max-w-3xl", className)}>
      {eyebrow && <Eyebrow onDark={onDark}>{eyebrow}</Eyebrow>}
      <h2 id={id} className={clsx("mt-3 font-display text-3xl font-semibold leading-[1.1] tracking-tight sm:text-4xl lg:text-[44px]", onDark ? "text-side-ink" : "text-ink")}>
        {title}
      </h2>
      {lead && <p className={clsx("mt-4 text-base leading-relaxed sm:text-lg", onDark ? "text-side-muted" : "text-muted")}>{lead}</p>}
    </div>
  );
}

/** The small "this is illustrative" label every product mock carries. */
export function SampleTag({ children = "Sample data", onDark = false, className }: { children?: ReactNode; onDark?: boolean; className?: string }) {
  return (
    <span
      className={clsx(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        onDark ? "bg-white/10 text-side-ink" : "border border-line bg-surface-2 text-muted",
        className,
      )}
    >
      <Eye className="size-3" aria-hidden />
      {children}
    </span>
  );
}

/** Secondary button for dark (charcoal) sections, which stay dark in both themes. */
export const onDarkButton = "inline-flex items-center justify-center gap-1.5 rounded-xl border border-side-line bg-side-2 font-medium text-side-ink transition-colors hover:bg-white/10";

export function SiteNav() {
  const { me } = useSession();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panelRef.current?.contains(t) && !buttonRef.current?.contains(t)) setOpen(false);
    };
    const onResize = () => {
      if (window.innerWidth >= 1024) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <header
      className={clsx(
        "sticky top-0 z-40 border-b transition-[background-color,border-color,box-shadow]",
        scrolled || open ? "border-line bg-canvas/90 backdrop-blur-md" : "border-transparent bg-canvas",
      )}
    >
      <Container className="flex h-16 items-center justify-between gap-4">
        <Logo to="/" />
        <nav aria-label="Main" className="hidden lg:block">
          <ul className="flex items-center gap-1">
            {NAV_LINKS.map((l) => (
              <li key={l.id}>
                <SectionLink id={l.id} className="rounded-lg px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-ink">
                  {l.label}
                </SectionLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex items-center gap-2">
          {me ? (
            <Link to="/app" className={buttonClass({ variant: "primary", className: "max-sm:hidden" })}>
              Open LifePilot <ArrowRight className="size-4" aria-hidden />
            </Link>
          ) : (
            <>
              <Link to="/login" className={buttonClass({ variant: "ghost", className: "text-ink max-sm:hidden" })}>
                Sign in
              </Link>
              <Link to="/register" className={buttonClass({ variant: "dark", className: "max-sm:hidden" })}>
                Get started
              </Link>
            </>
          )}
          <button
            ref={buttonRef}
            type="button"
            className="grid size-10 place-items-center rounded-xl border border-line bg-surface text-ink lg:hidden"
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <X className="size-5" aria-hidden /> : <MenuIcon className="size-5" aria-hidden />}
          </button>
        </div>
      </Container>

      <div ref={panelRef} id={panelId} hidden={!open} className="border-t border-line bg-canvas lg:hidden">
        <Container className="py-4">
          <nav aria-label="Main mobile">
            <ul className="grid gap-1 sm:grid-cols-2">
              {NAV_LINKS.map((l) => (
                <li key={l.id}>
                  <SectionLink id={l.id} onNavigate={close} className="flex items-center justify-between rounded-xl px-3 py-3 text-base font-medium text-ink hover:bg-surface-2">
                    {l.label}
                    <ArrowRight className="size-4 text-muted" aria-hidden />
                  </SectionLink>
                </li>
              ))}
            </ul>
          </nav>
          <div className="mt-4 grid grid-cols-2 gap-2 border-t border-line pt-4">
            {me ? (
              <Link to="/app" onClick={close} className={buttonClass({ variant: "primary", size: "lg", className: "col-span-2" })}>
                Open LifePilot <ArrowRight className="size-4" aria-hidden />
              </Link>
            ) : (
              <>
                <Link to="/login" onClick={close} className={buttonClass({ size: "lg" })}>
                  Sign in
                </Link>
                <Link to="/register" onClick={close} className={buttonClass({ variant: "primary", size: "lg" })}>
                  Get started
                </Link>
              </>
            )}
          </div>
        </Container>
      </div>
    </header>
  );
}

export function SiteFooter() {
  const { config } = useSession();
  const supportEmail = config?.supportEmail ?? null;
  const linkCls = "text-sm text-side-muted transition-colors hover:text-side-ink";
  return (
    <footer className="bg-side text-side-ink">
      <Container className="py-14">
        <div className="grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <Logo to="/" onDark />
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-side-muted">
              A personal life manager that brings your tasks, emails, calendar and reminders together — and helps you plan a day you can actually finish.
            </p>
            <p className="mt-5 inline-flex items-center gap-2 rounded-full border border-side-line px-3 py-1 text-xs text-side-muted">
              <span className="size-1.5 rounded-full bg-accent" aria-hidden /> Early access · billing not live
            </p>
          </div>
          <nav aria-label="Footer" className="grid grid-cols-2 gap-8 sm:grid-cols-3 lg:col-span-7">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-side-ink">Product</p>
              <ul className="mt-4 space-y-2.5">
                <li><SectionLink id="features" className={linkCls}>Features</SectionLink></li>
                <li><SectionLink id="how-it-works" className={linkCls}>How it works</SectionLink></li>
                <li><SectionLink id="pricing" className={linkCls}>Pricing</SectionLink></li>
                <li><SectionLink id="faq" className={linkCls}>FAQ</SectionLink></li>
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-side-ink">Company</p>
              <ul className="mt-4 space-y-2.5">
                <li><SectionLink id="about" className={linkCls}>About</SectionLink></li>
                <li><SectionLink id="privacy" className={linkCls}>Privacy &amp; security</SectionLink></li>
                <li><Link to="/privacy" className={linkCls}>Privacy policy</Link></li>
                <li><Link to="/terms" className={linkCls}>Terms of service</Link></li>
              </ul>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-side-ink">Contact &amp; support</p>
              <ul className="mt-4 space-y-2.5">
                <li>
                  {supportEmail ? (
                    <a href={`mailto:${supportEmail}`} className={clsx(linkCls, "break-all")}>{supportEmail}</a>
                  ) : (
                    <span className="text-sm text-side-muted">Support contact coming soon</span>
                  )}
                </li>
                <li><Link to="/support" className={linkCls}>Contact support</Link></li>
                <li><SectionLink id="faq" className={linkCls}>Help &amp; answers</SectionLink></li>
              </ul>
            </div>
          </nav>
        </div>
        <div className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-side-line pt-6 text-xs text-side-muted">
          <span>© {new Date().getFullYear()} LifePilot AI</span>
          <span>Export or delete your data any time from Settings.</span>
        </div>
      </Container>
    </footer>
  );
}
