import { ArrowLeft, Info } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Container, Eyebrow, SiteFooter, SiteNav } from "../components/marketing/site";
import { cardClass } from "../components/ui";
import { useSession } from "../session";

interface LegalSection {
  id: string;
  title: string;
  body: ReactNode;
}

function LegalLayout({ eyebrow, title, intro, notice, sections }: { eyebrow: string; title: string; intro: ReactNode; notice: ReactNode; sections: LegalSection[] }) {
  return (
    <div className="min-h-screen overflow-x-clip bg-canvas text-ink">
      <SiteNav />
      <main>
        <header className="border-b border-line">
          <Container className="py-12 sm:py-16">
            <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
              <ArrowLeft className="size-4" aria-hidden /> Back to home
            </Link>
            <Eyebrow className="mt-8">{eyebrow}</Eyebrow>
            <h1 className="mt-3 max-w-3xl font-display text-4xl font-semibold tracking-tight sm:text-5xl">{title}</h1>
            <div className="mt-5 max-w-2xl text-lg leading-relaxed text-muted">{intro}</div>
          </Container>
        </header>
        <Container className="grid gap-10 py-12 sm:py-16 lg:grid-cols-12">
          <nav aria-label="On this page" className="lg:col-span-3 2xl:col-span-2">
            <div className="lg:sticky lg:top-24">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">On this page</p>
              <ol className="mt-3 flex flex-col gap-1 border-l border-line">
                {sections.map((s) => (
                  <li key={s.id}>
                    <a href={`#${s.id}`} className="-ml-px block border-l border-transparent py-1.5 pl-4 text-sm text-muted hover:border-ink hover:text-ink">
                      {s.title}
                    </a>
                  </li>
                ))}
              </ol>
            </div>
          </nav>
          <div className="min-w-0 lg:col-span-9 lg:col-start-4 2xl:col-span-10 2xl:col-start-3">
            <div role="note" className="mb-10 flex max-w-4xl items-start gap-3 rounded-2xl border border-accent/50 bg-accent-soft px-4 py-4 text-sm leading-relaxed text-ink">
              <Info className="mt-0.5 size-4 shrink-0 text-accent-strong" aria-hidden />
              <div>{notice}</div>
            </div>
            <div className="grid items-start gap-6 2xl:grid-cols-2">
              {sections.map((s, i) => (
                <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`} className={`${cardClass} scroll-mt-24 p-6 sm:p-8`}>
                  <h2 id={`${s.id}-h`} className="flex items-baseline gap-3 font-display text-xl font-semibold tracking-tight">
                    <span className="font-mono text-sm text-muted">{String(i + 1).padStart(2, "0")}</span>
                    {s.title}
                  </h2>
                  <div className="mt-4 max-w-3xl space-y-3 text-[15px] leading-relaxed text-muted [&_strong]:font-semibold [&_strong]:text-ink [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5">{s.body}</div>
                </section>
              ))}
            </div>
          </div>
        </Container>
      </main>
      <SiteFooter />
    </div>
  );
}

function SupportLine() {
  const { config } = useSession();
  return config?.supportEmail ? (
    <p>
      Questions about your data? Email{" "}
      <a href={`mailto:${config.supportEmail}`} className="break-all font-medium text-accent-strong underline-offset-2 hover:underline">
        {config.supportEmail}
      </a>
      .
    </p>
  ) : (
    <p>A dedicated support contact is coming soon. Until then, every control described here — export, disconnect and account deletion — is available to you directly in Settings.</p>
  );
}

export function PrivacyPage() {
  const sections: LegalSection[] = [
    {
      id: "summary",
      title: "The short version",
      body: (
        <ul>
          <li>LifePilot stores what it needs to run your tasks, plans and reminders — nothing more.</li>
          <li>Gmail and Google Calendar are optional and connected with <strong>read-only</strong> access.</li>
          <li>AI analysis is optional. Turn it off and nothing is sent to an AI provider.</li>
          <li>You can export your data, disconnect integrations or delete your account at any time.</li>
        </ul>
      ),
    },
    {
      id: "what-we-store",
      title: "What we store",
      body: (
        <>
          <p>To provide the service, LifePilot stores your account details (name, email address and a hashed password) and the content you create or approve:</p>
          <ul>
            <li>Tasks, subtasks, projects and tags</li>
            <li>Calendar events you add, and events imported from Google Calendar if you connect it</li>
            <li>Daily plans, reminders and notifications</li>
            <li>Your preferences, such as working hours, quiet hours, time zone, sounds and theme</li>
          </ul>
          <p>Sessions use a secure, httpOnly cookie; only a hash of the session token is stored.</p>
        </>
      ),
    },
    {
      id: "email",
      title: "Email data",
      body: (
        <>
          <p>If you connect Gmail, LifePilot reads recent messages in a limited window (14 days by default), excluding promotions, social, sent mail and drafts. For each synced email it keeps only:</p>
          <ul>
            <li>The subject, sender and date</li>
            <li>Gmail's short snippet</li>
            <li>A text excerpt of at most <strong>4,000 characters</strong>, used to find deadlines and requests</li>
          </ul>
          <p>Full message bodies and attachments are not stored. LifePilot cannot send, delete, forward or reply to email.</p>
        </>
      ),
    },
    {
      id: "google",
      title: "Google access",
      body: (
        <>
          <p>
            LifePilot requests only the read-only scopes <strong>gmail.readonly</strong> and <strong>calendar.readonly</strong>, and only when you choose to connect. It never edits your Google Calendar.
          </p>
          <p>Google access tokens are encrypted at rest and are never sent to your browser. Disconnecting revokes access at Google, and you can choose to delete everything that was imported.</p>
        </>
      ),
    },
    {
      id: "ai",
      title: "AI processing",
      body: (
        <>
          <p>
            When AI analysis is on, the email excerpt is sent to the configured AI provider (OpenAI) to extract tasks and deadlines. Email content is treated as data: instructions inside emails are ignored and flagged, and suggestions only become tasks after you approve them.
          </p>
          <p>When AI analysis is off, a built-in rule engine runs on our servers instead and <strong>nothing is sent to an AI provider</strong>.</p>
        </>
      ),
    },
    {
      id: "controls",
      title: "Your controls",
      body: (
        <ul>
          <li><strong>Export</strong> — download all your data from Settings.</li>
          <li><strong>Disconnect</strong> — remove Gmail or Google Calendar, with the option to delete imported data.</li>
          <li><strong>Delete your account</strong> — removes your account and everything in it, and revokes Google access.</li>
          <li><strong>Switch AI off</strong> — at any time, in Settings.</li>
        </ul>
      ),
    },
    {
      id: "demo",
      title: "Demo mode",
      body: <p>Demo mode fills LifePilot with synthetic sample data so you can explore every feature without connecting any real account.</p>,
    },
    {
      id: "contact",
      title: "Contact",
      body: <SupportLine />,
    },
  ];
  return (
    <LegalLayout
      eyebrow="Privacy"
      title="How LifePilot handles your data"
      intro={<p>A plain-language summary of what LifePilot stores, why, and how you stay in control.</p>}
      notice={
        <p>
          <strong className="font-semibold">This is a summary, not the formal privacy policy.</strong> LifePilot is in early access. The formal privacy policy will be published before general availability; this page describes how the product handles data today.
        </p>
      }
      sections={sections}
    />
  );
}

export function TermsPage() {
  const sections: LegalSection[] = [
    {
      id: "status",
      title: "Where things stand",
      body: (
        <>
          <p>LifePilot AI is in <strong>early access</strong>. Features may change as the product develops, and some parts — such as an AI chat assistant and a mobile app — are not available yet.</p>
          <p>The full Terms of service will be published before general availability. Until then, this page lists what is true today.</p>
        </>
      ),
    },
    {
      id: "billing",
      title: "Billing",
      body: (
        <>
          <p><strong>Billing is not live.</strong> No card is collected and nothing is charged. Choosing a plan on the website does not start a subscription.</p>
          <p>Before any billing starts, prices, renewal and cancellation terms will be published and shown to you.</p>
        </>
      ),
    },
    {
      id: "your-data",
      title: "Your data",
      body: (
        <p>
          You can export your data, disconnect integrations or delete your account at any time from Settings. See <Link to="/privacy" className="font-medium text-accent-strong underline-offset-2 hover:underline">how LifePilot handles your data</Link> for details.
        </p>
      ),
    },
    {
      id: "ai-suggestions",
      title: "AI suggestions",
      body: <p>LifePilot's suggestions — including deadlines found in emails — can be wrong. That's why nothing is created from an email until you review and approve it. Please check important dates against the original message.</p>,
    },
    {
      id: "contact",
      title: "Contact",
      body: <SupportLine />,
    },
  ];
  return (
    <LegalLayout
      eyebrow="Terms"
      title="Terms of service"
      intro={<p>The Terms of service will be published before general availability.</p>}
      notice={
        <p>
          <strong className="font-semibold">Not the final terms.</strong> This page is an honest summary of how LifePilot works during early access. It is not a substitute for the full Terms of service, which are still being prepared.
        </p>
      }
      sections={sections}
    />
  );
}
