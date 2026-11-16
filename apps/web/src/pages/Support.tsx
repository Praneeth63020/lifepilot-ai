import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { Container, Eyebrow, SiteFooter, SiteNav } from "../components/marketing/site";
import { SupportContactCard, SupportTopics } from "../components/SupportContent";
import { PageHeader } from "../components/ui";

/** Public Contact Support page (/support). */
export function SupportPage() {
  return (
    <div className="min-h-screen overflow-x-clip bg-canvas text-ink">
      <SiteNav />
      <main>
        <header className="border-b border-line">
          <Container className="grid gap-10 py-12 sm:py-16 lg:grid-cols-12 lg:items-end">
            <div className="lg:col-span-6 2xl:col-span-7">
              <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
                <ArrowLeft className="size-4" aria-hidden /> Back to home
              </Link>
              <Eyebrow className="mt-8">Help &amp; support</Eyebrow>
              <h1 className="mt-3 max-w-3xl font-display text-4xl font-semibold tracking-tight sm:text-5xl">How can we help?</h1>
              <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted">
                Questions about your account, something not working, an idea for LifePilot, or a question about plans: we're here for all of it.
              </p>
            </div>
            <SupportContactCard className="lg:col-span-6 2xl:col-span-5" />
          </Container>
        </header>
        <Container className="py-12 sm:py-16">
          <SupportTopics />
        </Container>
      </main>
      <SiteFooter />
    </div>
  );
}

/** The same help inside the app (/app/support). */
export function AppSupportPage() {
  return (
    <div>
      <PageHeader title="Help & support" subtitle="Get answers fast, or contact the LifePilot team." />
      <div className="grid gap-6 xl:grid-cols-12">
        <SupportContactCard className="self-start xl:col-span-4" />
        <div className="xl:col-span-8">
          <SupportTopics inApp />
        </div>
      </div>
    </div>
  );
}
