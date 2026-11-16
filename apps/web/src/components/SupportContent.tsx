import clsx from "clsx";
import { Bug, Clock, CreditCard, KeyRound, LifeBuoy, Mail, MessageSquareHeart, ShieldCheck, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { buttonClass, cardClass } from "./ui";
import { useSession } from "../session";

const linkCls = "font-medium text-accent-strong underline-offset-2 hover:underline";

function mailto(address: string, subject: string) {
  return `mailto:${address}?subject=${encodeURIComponent(subject)}`;
}

/** The support address and (only if configured) the expected reply time. */
export function SupportContactCard({ className }: { className?: string }) {
  const { config } = useSession();
  const email = config?.supportEmail ?? null;
  return (
    <section aria-labelledby="support-contact-h" className={clsx("overflow-hidden rounded-[var(--radius-card)] bg-side text-side-ink shadow-card", className)}>
      <div className="p-6 sm:p-8">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-side-2 text-accent">
            <LifeBuoy className="size-5" aria-hidden />
          </span>
          <h2 id="support-contact-h" className="font-display text-xl font-semibold tracking-tight">Contact LifePilot support</h2>
        </div>
        {email ? (
          <>
            <p className="mt-4 text-sm leading-relaxed text-side-muted">Email us and a person will reply. Write from the address you signed up with, so we can find your account.</p>
            <a href={mailto(email, "LifePilot support")} className="mt-5 flex items-center gap-2 break-all font-display text-lg font-semibold text-side-ink underline-offset-4 hover:underline sm:text-xl" data-testid="support-email">
              <Mail className="size-5 shrink-0 text-accent" aria-hidden /> {email}
            </a>
            {config?.supportResponseTime && (
              <p className="mt-3 flex items-center gap-2 text-sm text-side-muted">
                <Clock className="size-4 shrink-0 text-accent" aria-hidden /> We usually reply {config.supportResponseTime}.
              </p>
            )}
          </>
        ) : (
          <p className="mt-4 text-sm leading-relaxed text-side-muted">
            A support email address is coming soon. Until then, you can reset your password, export your data or delete your account yourself; the guides below show how.
          </p>
        )}
        <p className="mt-5 border-t border-side-line pt-4 text-xs leading-relaxed text-side-muted">
          We will never ask for your password, or for a reset or verification link. Don't send them to anyone, including us.
        </p>
      </div>
    </section>
  );
}

interface Topic {
  id: string;
  icon: LucideIcon;
  title: string;
  body: ReactNode;
  subject: string;
}

/** Help topics: what we can help with, and how to get the fastest answer. */
export function SupportTopics({ inApp = false }: { inApp?: boolean }) {
  const { config } = useSession();
  const email = config?.supportEmail ?? null;
  const settings = (tab: string) => (inApp ? `/app/settings?tab=${encodeURIComponent(tab)}` : "/login");
  const topics: Topic[] = [
    {
      id: "account",
      icon: KeyRound,
      title: "Account and sign-in",
      subject: "Account help",
      body: (
        <ul>
          <li>
            <strong>Forgot your password?</strong> You don't need to contact us: <Link className={linkCls} to="/forgot-password">reset it here</Link>. The link we email works for 1 hour.
          </li>
          <li>
            <strong>Verification link expired?</strong> {inApp ? <>Send a new one from <Link className={linkCls} to={settings("security")}>Settings → Security</Link>.</> : <>Sign in, then go to Settings → Security → Resend verification email.</>}
          </li>
          <li><strong>Signed in somewhere you don't recognise?</strong> Change your password; that signs out every device.</li>
        </ul>
      ),
    },
    {
      id: "bugs",
      icon: Bug,
      title: "Report a bug",
      subject: "Bug report",
      body: (
        <>
          <p>Tell us:</p>
          <ul>
            <li>what you were doing, what you expected, and what happened instead;</li>
            <li>the page, and your browser and device;</li>
            <li>roughly when it happened, with your time zone;</li>
            <li>a screenshot if it helps (hide anything private first).</li>
          </ul>
        </>
      ),
    },
    {
      id: "feedback",
      icon: MessageSquareHeart,
      title: "Feedback and ideas",
      subject: "Feedback",
      body: <p>What's working, what's confusing, and what you wish LifePilot did. Every message is read, and it shapes what we build next.</p>,
    },
    {
      id: "plans",
      icon: CreditCard,
      title: "Plans and billing",
      subject: "Plans and billing",
      body: <p>LifePilot is in early access: billing isn't live, no card is needed and nothing is charged. Questions about the Weekly, Monthly and Six-month plans are welcome.</p>,
    },
    {
      id: "data",
      icon: ShieldCheck,
      title: "Privacy and your data",
      subject: "Privacy question",
      body: (
        <p>
          You can export your data, disconnect Google or delete your account yourself {inApp ? <>in <Link className={linkCls} to={settings("privacy & data")}>Settings → Privacy &amp; data</Link></> : "in Settings"}. Read <Link className={linkCls} to="/privacy">how LifePilot handles your data</Link>.
        </p>
      ),
    },
  ];
  return (
    <div className="grid items-start gap-5 md:grid-cols-2 2xl:grid-cols-3">
      {topics.map((t) => (
        <section key={t.id} id={t.id} aria-labelledby={`${t.id}-h`} className={clsx(cardClass, "flex h-full scroll-mt-24 flex-col p-6")}>
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-xl bg-accent-soft text-accent-strong">
              <t.icon className="size-[18px]" aria-hidden />
            </span>
            <h2 id={`${t.id}-h`} className="font-display text-lg font-semibold tracking-tight">{t.title}</h2>
          </div>
          <div className="mt-4 flex-1 space-y-2 text-sm leading-relaxed text-muted [&_strong]:font-semibold [&_strong]:text-ink [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5">{t.body}</div>
          {email && (
            <a href={mailto(email, t.subject)} className={clsx(buttonClass({ variant: "secondary", size: "sm" }), "mt-5 self-start")}>
              <Mail className="size-4" aria-hidden /> Email us about this
            </a>
          )}
        </section>
      ))}
    </div>
  );
}
