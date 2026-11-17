import {
  ArrowRight,
  BrainCircuit,
  CalendarDays,
  Check,
  CircleCheck,
  Download,
  Eye,
  EyeOff,
  Inbox,
  KeyRound,
  Lock,
  Mail,
  MessageSquare,
  NotebookPen,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Unplug,
  UserCheck,
} from "lucide-react";
import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { FaqAccordion } from "../components/marketing/FaqAccordion";
import { FeatureDemos } from "../components/marketing/FeatureDemos";
import { HeroPreview } from "../components/marketing/HeroPreview";
import { HowItWorks } from "../components/marketing/HowItWorks";
import { PricingSection } from "../components/marketing/PricingSection";
import { ProductBento } from "../components/marketing/ProductBento";
import { Container, Eyebrow, onDarkButton, SectionHeading, SectionLink, SiteFooter, SiteNav } from "../components/marketing/site";
import { buttonClass, cardClass } from "../components/ui";
import { FAQ } from "../content/faq";
import { useSession } from "../session";

const sectionCls = "scroll-mt-16 focus:outline-none";

export function LandingPage() {
  const { me, config } = useSession();
  const { hash } = useLocation();

  // Arriving from another page with /#section: jump there once the page has rendered.
  useEffect(() => {
    if (!hash) return;
    const el = document.getElementById(decodeURIComponent(hash.slice(1)));
    el?.scrollIntoView({ block: "start" });
  }, [hash]);

  return (
    <div className="min-h-screen overflow-x-clip bg-canvas text-ink">
      <a href="#main" className="sr-only z-50 rounded-lg bg-ink px-3 py-2 text-canvas focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
        Skip to content
      </a>
      <SiteNav />

      <main id="main">
        {/* ---------------------------------------------------------------- Hero */}
        <section id="top" tabIndex={-1} aria-labelledby="hero-title" className={sectionCls}>
          <Container className="grid items-center gap-12 pb-20 pt-10 sm:pt-14 lg:grid-cols-12 lg:gap-10 lg:pb-28 lg:pt-20">
            <div className="lg:col-span-5">
              <p className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-muted shadow-card">
                <span className="size-1.5 rounded-full bg-accent" aria-hidden /> Personal life manager · early access
              </p>
              <h1 id="hero-title" className="isolate mt-6 font-display text-[40px] font-semibold leading-[1.04] tracking-tight text-ink sm:text-[56px] lg:text-[60px] 2xl:text-[76px]">
                Your entire life, <span className="relative whitespace-nowrap">intelligently<span aria-hidden className="absolute inset-x-0 bottom-1 -z-10 h-3 rounded-sm bg-accent/60 sm:bottom-2 sm:h-4" /></span> organised.
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted 2xl:text-xl">
                Bring your tasks, emails, calendar, commitments and reminders together. LifePilot helps you understand what matters, plan your day and stay ahead of everything important.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                {me ? (
                  <Link to="/app" className={buttonClass({ variant: "primary", size: "lg" })}>
                    Open LifePilot <ArrowRight className="size-4" aria-hidden />
                  </Link>
                ) : (
                  <Link to="/register" className={buttonClass({ variant: "primary", size: "lg" })}>
                    Get Started <ArrowRight className="size-4" aria-hidden />
                  </Link>
                )}
                <SectionLink id="features" className={buttonClass({ size: "lg" })}>
                  Explore LifePilot
                </SectionLink>
              </div>
              <ul className="mt-8 grid gap-x-6 gap-y-2.5 text-sm text-muted sm:grid-cols-2">
                {["Gmail & Calendar optional, read-only", "You approve every AI suggestion", "AI can be switched off", "No card needed during early access"].map((t) => (
                  <li key={t} className="flex items-center gap-2">
                    <CircleCheck className="size-4 shrink-0 text-ok" aria-hidden /> {t}
                  </li>
                ))}
              </ul>
            </div>
            <div className="min-w-0 lg:col-span-7">
              <HeroPreview />
            </div>
          </Container>
        </section>

        {/* ---------------------------------------------------------------- Strip of real integrations / principles */}
        <div className="border-y border-line bg-surface">
          <Container className="grid grid-cols-2 gap-x-4 lg:grid-cols-4">
            {[
              { icon: Mail, t: "Gmail", d: "Read-only · optional" },
              { icon: CalendarDays, t: "Google Calendar", d: "Read-only · optional" },
              { icon: BrainCircuit, t: "AI analysis", d: "Optional · can be off" },
              { icon: Smartphone, t: "Browser push", d: "Plus in-app sounds" },
            ].map(({ icon: Icon, t, d }) => (
              <div key={t} className="flex items-center gap-3 py-5">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-ink" aria-hidden>
                  <Icon className="size-5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink">{t}</span>
                  <span className="block text-xs text-muted">{d}</span>
                </span>
              </div>
            ))}
          </Container>
        </div>

        {/* ---------------------------------------------------------------- Product overview */}
        <section id="features" tabIndex={-1} aria-labelledby="features-title" className={sectionCls}>
          <Container className="py-20 sm:py-24">
            <div className="mb-12 grid gap-6 lg:grid-cols-12 lg:items-end">
              <SectionHeading
                id="features-title"
                className="lg:col-span-7"
                eyebrow="Product overview"
                title="Everything that needs your attention, in one calm place."
              />
              <p className="text-base leading-relaxed text-muted lg:col-span-5">
                LifePilot connects the pieces of your life that usually live apart — your to-do list, your inbox, your calendar and your reminders — so you can see what's important and act on it.
              </p>
            </div>
            <ProductBento />
          </Container>
        </section>

        {/* ---------------------------------------------------------------- How it works */}
        <section id="how-it-works" tabIndex={-1} aria-labelledby="how-title" className={`${sectionCls} bg-side`}>
          <Container className="py-20 sm:py-24">
            <SectionHeading
              id="how-title"
              onDark
              align="center"
              eyebrow="How it works"
              title="From scattered to sorted, in five steps."
              lead="You stay in control at every step: you choose what to connect, approve what gets created and decide when to replan."
              className="mb-14"
            />
            <HowItWorks />
          </Container>
        </section>

        {/* ---------------------------------------------------------------- Feature demonstrations */}
        <div aria-label="Feature tour">
          <Container className="pt-20 sm:pt-24">
            <SectionHeading eyebrow="A closer look" title="See how each part works." lead="Every preview below uses sample data to show the real screens and behaviour." />
          </Container>
          <FeatureDemos />
        </div>

        {/* ---------------------------------------------------------------- Pricing */}
        <section id="pricing" tabIndex={-1} aria-labelledby="pricing-title" className={`${sectionCls} border-t border-line bg-surface-2/50`}>
          <Container className="py-20 sm:py-24">
            <SectionHeading
              id="pricing-title"
              align="center"
              eyebrow="Pricing"
              title="Simple plans. Pick how often you'd like to pay."
              lead="Every plan includes the full product. We're in early access, so you can start using LifePilot now."
              className="mb-10"
            />
            <PricingSection />
          </Container>
        </section>

        {/* ---------------------------------------------------------------- About */}
        <section id="about" tabIndex={-1} aria-labelledby="about-title" className={sectionCls}>
          <Container className="grid gap-12 py-20 sm:py-24 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <SectionHeading id="about-title" eyebrow="About" title="Why LifePilot exists." />
              <div className="mt-6 max-w-2xl space-y-4 text-base leading-relaxed text-muted">
                <p>
                  Responsibilities don't arrive in one place. A deadline hides in an email thread, a meeting sits in a calendar, a promise lives in your head, and a bill waits in another tab. Keeping track of all of it is work in itself.
                </p>
                <p>
                  That invisible mental load is what LifePilot is built to carry. It gathers your commitments, highlights what matters and turns it into a plan you can actually follow — without taking decisions away from you.
                </p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:col-span-7">
              <div className="rounded-[var(--radius-card)] border border-side-line bg-side p-6 text-side-ink sm:col-span-2">
                <Eyebrow onDark>Our vision</Eyebrow>
                <p className="mt-3 font-display text-2xl font-semibold leading-snug tracking-tight">
                  An intelligent, transparent and user-controlled personal life manager.
                </p>
                <div className="mt-6 grid gap-4 sm:grid-cols-3">
                  {[
                    { icon: BrainCircuit, t: "Intelligent", d: "Understands emails and calendars well enough to suggest what to do next." },
                    { icon: Eye, t: "Transparent", d: "Shows why something matters and the sentence a deadline came from." },
                    { icon: UserCheck, t: "User-controlled", d: "You approve suggestions, choose connections and can switch AI off." },
                  ].map(({ icon: Icon, t, d }) => (
                    <div key={t}>
                      <Icon className="size-5 text-accent" aria-hidden />
                      <p className="mt-2 font-semibold">{t}</p>
                      <p className="mt-1 text-sm leading-relaxed text-side-muted">{d}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className={`${cardClass} p-6`}>
                <p className="text-sm font-semibold text-ink">What's available today</p>
                <ul className="mt-3 space-y-2 text-sm text-muted">
                  {["Tasks, projects and the daily planner", "Calendar with conflict detection", "Smart inbox for Gmail", "Reminders, sounds and browser push", "Demo mode with synthetic data"].map((t) => (
                    <li key={t} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden /> {t}</li>
                  ))}
                </ul>
              </div>
              <div className={`${cardClass} p-6`}>
                <p className="text-sm font-semibold text-ink">Coming soon</p>
                <ul className="mt-3 space-y-2 text-sm text-muted">
                  {[
                    { icon: MessageSquare, t: "AI chat assistant" },
                    { icon: Smartphone, t: "Mobile app" },
                    { icon: KeyRound, t: "Billing and plan management" },
                  ].map(({ icon: Icon, t }) => (
                    <li key={t} className="flex items-center gap-2">
                      <Icon className="size-4 shrink-0 text-muted" aria-hidden /> {t}
                      <span className="ml-auto shrink-0 whitespace-nowrap rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted">Coming soon</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Container>
        </section>

        {/* ---------------------------------------------------------------- Privacy & security */}
        <section id="privacy" tabIndex={-1} aria-labelledby="privacy-title" className={`${sectionCls} border-y border-line bg-surface`}>
          <Container className="grid gap-12 py-20 sm:py-24 lg:grid-cols-12">
            <div className="lg:col-span-4">
              <SectionHeading id="privacy-title" eyebrow="Privacy & security" title="Your data, on your terms." lead="LifePilot asks for as little as it needs, explains what it does, and lets you take it all back." />
              <Link to="/privacy" className={buttonClass({ className: "mt-8" })}>
                How we handle your data <ArrowRight className="size-4" aria-hidden />
              </Link>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:col-span-8 2xl:grid-cols-3">
              {[
                { icon: Lock, t: "Read-only Google access", d: "Gmail and Calendar use read-only scopes. LifePilot can't send, delete or reply to email, or edit your calendar." },
                { icon: Unplug, t: "You authorise, you disconnect", d: "Connect only what you choose. Disconnect any time and optionally delete everything that was imported." },
                { icon: CircleCheck, t: "Approval before action", d: "AI suggestions are suggestions. A task is only created from an email after you approve it." },
                { icon: EyeOff, t: "AI can be turned off", d: "With AI off, a built-in rule engine is used and nothing is sent to an AI provider." },
                { icon: Download, t: "Export or delete", d: "Download all your data, or delete your account and everything in it, from Settings." },
                { icon: ShieldCheck, t: "Encrypted Google tokens", d: "Google access tokens are encrypted at rest and never sent to your browser." },
              ].map(({ icon: Icon, t, d }) => (
                <div key={t} className="flex gap-4 rounded-2xl border border-line bg-canvas p-5">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface text-ink shadow-card" aria-hidden>
                    <Icon className="size-5" />
                  </span>
                  <span>
                    <span className="block font-semibold text-ink">{t}</span>
                    <span className="mt-1 block text-sm leading-relaxed text-muted">{d}</span>
                  </span>
                </div>
              ))}
              <div className="flex items-start gap-4 rounded-2xl border border-line bg-surface-2 p-5 sm:col-span-2 2xl:col-span-3">
                <SlidersHorizontal className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden />
                <p className="text-sm leading-relaxed text-muted">
                  Instructions inside emails are treated as text, never as commands — messages that try to instruct an AI are flagged for you. Try everything first with <span className="font-medium text-ink">demo mode</span>, which uses synthetic data only.
                </p>
              </div>
            </div>
          </Container>
        </section>

        {/* ---------------------------------------------------------------- FAQ */}
        <section id="faq" tabIndex={-1} aria-labelledby="faq-title" className={sectionCls}>
          <Container className="grid gap-10 py-20 sm:py-24 lg:grid-cols-12">
            <div className="lg:col-span-4">
              <div className="lg:sticky lg:top-24">
                <SectionHeading id="faq-title" eyebrow="FAQ" title="Questions, answered honestly." />
                <div className={`${cardClass} mt-8 p-5`}>
                  <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                    <Inbox className="size-4" aria-hidden /> Still have a question?
                  </p>
                  {config?.supportEmail ? (
                    <p className="mt-2 text-sm text-muted">
                      Write to{" "}
                      <a href={`mailto:${config.supportEmail}`} className="break-all font-medium text-accent-strong underline-offset-2 hover:underline">
                        {config.supportEmail}
                      </a>
                      .
                    </p>
                  ) : (
                    <p className="mt-2 text-sm text-muted">Support contact coming soon. Meanwhile, you can manage connections, export or delete your data from Settings.</p>
                  )}
                </div>
              </div>
            </div>
            <div className="lg:col-span-8">
              <FaqAccordion items={FAQ} ctx={{ supportEmail: config?.supportEmail ?? null }} defaultOpen="what" />
            </div>
          </Container>
        </section>

        {/* ---------------------------------------------------------------- Final CTA */}
        <section aria-labelledby="cta-title" className="pb-20 sm:pb-24">
          <Container>
            <div className="relative overflow-hidden rounded-[32px] bg-side px-6 py-14 text-center sm:px-12 sm:py-16">
              <div aria-hidden className="pointer-events-none absolute -top-24 left-1/2 h-64 w-[640px] max-w-full -translate-x-1/2 rounded-full bg-accent/20 blur-3xl" />
              <NotebookPen className="relative mx-auto size-8 text-accent" aria-hidden />
              <h2 id="cta-title" className="relative mx-auto mt-5 max-w-2xl font-display text-3xl font-semibold tracking-tight text-side-ink sm:text-4xl">
                Give your commitments a home — and your mind a break.
              </h2>
              <p className="relative mx-auto mt-4 max-w-xl text-side-muted">Start with a few tasks. Connect Gmail and Calendar whenever you're ready, or never.</p>
              <div className="relative mt-8 flex flex-wrap justify-center gap-3">
                {me ? (
                  <Link to="/app" className={buttonClass({ variant: "primary", size: "lg" })}>
                    Open LifePilot <ArrowRight className="size-4" aria-hidden />
                  </Link>
                ) : (
                  <>
                    <Link to="/register" className={buttonClass({ variant: "primary", size: "lg" })}>
                      Get Started <ArrowRight className="size-4" aria-hidden />
                    </Link>
                    <Link to="/login" className={`${onDarkButton} h-12 px-6 text-base`}>
                      Sign in
                    </Link>
                  </>
                )}
              </div>
            </div>
          </Container>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
