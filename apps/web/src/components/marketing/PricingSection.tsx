import clsx from "clsx";
import { ArrowRight, Check, CreditCard, Info, Star } from "lucide-react";
import { Link } from "react-router-dom";
import { BILLING_LIVE, formatPrice, INCLUDED_FEATURES, PLANS, type Plan } from "../../content/pricing";
import { useSession } from "../../session";
import { buttonClass } from "../ui";

const PREVIEW_COUNT = 4;

function PlanCard({ plan, signedIn }: { plan: Plan; signedIn: boolean }) {
  const featured = plan.recommended;
  const href = signedIn ? "/app" : `/register?plan=${encodeURIComponent(plan.id)}`;
  return (
    <article
      aria-labelledby={`plan-${plan.id}`}
      className={clsx(
        "relative flex flex-col rounded-[28px] p-6 sm:p-7",
        featured ? "border border-side-line bg-side text-side-ink shadow-pop lg:-my-4 lg:py-10" : "border border-line bg-surface text-ink shadow-card",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id={`plan-${plan.id}`} className="font-display text-xl font-semibold tracking-tight">{plan.name}</h3>
          <p className={clsx("mt-1 text-sm", featured ? "text-side-muted" : "text-muted")}>{plan.durationLabel}</p>
        </div>
        {featured && (
          <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-xs font-semibold text-accent-ink">
            <Star className="size-3 fill-current" aria-hidden /> Recommended
          </span>
        )}
      </div>

      <div className={clsx("mt-6 border-y py-5", featured ? "border-side-line" : "border-line")}>
        {plan.price ? (
          <p className="flex items-baseline gap-1.5">
            <span className="font-display text-4xl font-semibold tracking-tight">{formatPrice(plan.price)}</span>
            <span className={clsx("text-sm", featured ? "text-side-muted" : "text-muted")}>/ {plan.periodUnit}</span>
          </p>
        ) : (
          <>
            <p className="font-display text-2xl font-semibold tracking-tight">Pricing coming soon</p>
            <p className={clsx("mt-1 text-sm", featured ? "text-side-muted" : "text-muted")}>Early access — no card needed, nothing charged.</p>
          </>
        )}
      </div>

      <p className={clsx("mt-5 text-[15px]", featured ? "text-side-ink" : "text-ink")}>{plan.summary}</p>
      <ul className="mt-5 flex flex-1 flex-col gap-2.5">
        {plan.features.slice(0, PREVIEW_COUNT).map((f) => (
          <li key={f} className="flex gap-2.5 text-sm">
            <Check className={clsx("mt-0.5 size-4 shrink-0", featured ? "text-accent" : "text-ok")} aria-hidden />
            <span className={featured ? "text-side-ink" : "text-ink"}>{f}</span>
          </li>
        ))}
      </ul>
      {plan.features.length > PREVIEW_COUNT && (
        <p className={clsx("mt-3 pl-6.5 text-sm", featured ? "text-side-muted" : "text-muted")}>+ {plan.features.length - PREVIEW_COUNT} more, included in every plan</p>
      )}

      <Link
        to={href}
        aria-label={signedIn ? `Open LifePilot (${plan.name} plan)` : `Get early access with the ${plan.name} plan`}
        className={buttonClass({ variant: featured ? "primary" : "dark", size: "lg", className: "mt-7 w-full" })}
      >
        {signedIn ? "Open LifePilot" : BILLING_LIVE ? `Choose ${plan.name}` : "Get early access"} <ArrowRight className="size-4" aria-hidden />
      </Link>
      <p className={clsx("mt-3 text-xs leading-relaxed", featured ? "text-side-muted" : "text-muted")}>{plan.renewalNote}</p>
    </article>
  );
}

/** Pricing driven entirely by content/pricing.ts. While billing isn't live, no prices are shown. */
export function PricingSection() {
  const { me } = useSession();
  return (
    <>
      {!BILLING_LIVE && (
        <div role="note" className="mx-auto mb-10 flex max-w-3xl items-start gap-3 rounded-2xl border border-accent/50 bg-accent-soft px-4 py-3.5 sm:items-center">
          <CreditCard className="mt-0.5 size-5 shrink-0 text-accent-strong sm:mt-0" aria-hidden />
          <p className="text-sm text-ink">
            <strong className="font-semibold">Billing isn't live yet.</strong> No card is needed and nothing is charged. Prices will be published here before billing starts.
          </p>
        </div>
      )}
      <div className="grid items-stretch gap-5 lg:grid-cols-3 lg:gap-6 2xl:grid-cols-4">
        {PLANS.map((p) => (
          <PlanCard key={p.id} plan={p} signedIn={Boolean(me)} />
        ))}
      <div className="mt-7 rounded-[28px] border border-line bg-surface p-6 sm:p-8 lg:col-span-3 2xl:col-span-1 2xl:mt-0">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h3 className="font-display text-xl font-semibold tracking-tight text-ink">Included in every plan</h3>
          <p className="flex items-center gap-1.5 text-sm text-muted">
            <Info className="size-4 shrink-0" aria-hidden /> Plans differ only in billing period.
          </p>
        </div>
        <ul className="mt-6 grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-1">
          {INCLUDED_FEATURES.map((f) => (
            <li key={f} className="flex gap-2.5 text-sm text-ink">
              <Check className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
              {f}
            </li>
          ))}
        </ul>
        <p className="mt-6 border-t border-line pt-4 text-xs text-muted">Not available yet: AI chat assistant, mobile app, billing and plan management.</p>
      </div>
      </div>
    </>
  );
}
