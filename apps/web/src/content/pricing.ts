/**
 * Pricing plans shown on the public website and referenced by /register?plan=<id>.
 *
 * Billing is NOT live: there is no payment provider, nothing is charged and no card is collected.
 * Prices are intentionally unset (`price: null`) — the UI then shows a "pricing coming soon" state.
 * To publish prices later, set `price` (e.g. { amount: 9, currency: "USD" }) and flip BILLING_LIVE
 * only once real billing exists. Plans differ only in billing period: every plan includes every
 * current feature.
 */

export interface PlanPrice {
  /** Amount per billing period, in the currency's major unit (e.g. 9.5 = 9.50). */
  amount: number;
  /** ISO 4217 code, e.g. "USD". */
  currency: string;
}

export interface Plan {
  id: string;
  name: string;
  /** Short billing-period label, e.g. "Billed every week". */
  durationLabel: string;
  /** Unit shown after a price, e.g. "week". */
  periodUnit: string;
  price: PlanPrice | null;
  /** One line on who the plan suits. */
  summary: string;
  features: string[];
  recommended: boolean;
  /** Renewal / cancellation wording shown under the plan. */
  renewalNote: string;
}

/** Whether real billing exists. While false the site says no card is needed and nothing is charged. */
export const BILLING_LIVE = false;

/** Every plan includes every feature that exists today; plans differ only in billing period. */
export const INCLUDED_FEATURES: string[] = [
  "Tasks with subtasks, recurrence, tags and priorities",
  "Projects with progress and next deadlines",
  "Daily planner around your calendar and working hours",
  "Calendar with conflict detection",
  "Smart inbox with deadline extraction you approve",
  "Reminders with quiet hours, snooze and browser push",
  "Gmail and Google Calendar, read-only and optional",
  "Export or delete your data at any time",
];

export const PLANS: Plan[] = [
  {
    id: "weekly",
    name: "Weekly",
    durationLabel: "Billed every week",
    periodUnit: "week",
    price: null,
    summary: "For trying LifePilot through a busy week or two.",
    features: INCLUDED_FEATURES,
    recommended: false,
    renewalNote: "Planned to renew weekly. Renewal and cancellation terms will be shown before billing starts.",
  },
  {
    id: "monthly",
    name: "Monthly",
    durationLabel: "Billed every month",
    periodUnit: "month",
    price: null,
    summary: "For keeping everyday life organised, month to month.",
    features: INCLUDED_FEATURES,
    recommended: true,
    renewalNote: "Planned to renew monthly. Renewal and cancellation terms will be shown before billing starts.",
  },
  {
    id: "six-month",
    name: "Six-month",
    durationLabel: "Billed every six months",
    periodUnit: "6 months",
    price: null,
    summary: "For a full semester, project season or half-year plan.",
    features: INCLUDED_FEATURES,
    recommended: false,
    renewalNote: "Planned to renew every six months. Renewal and cancellation terms will be shown before billing starts.",
  },
];

export function findPlan(id: string | null | undefined): Plan | undefined {
  if (!id) return undefined;
  return PLANS.find((p) => p.id === id);
}

export function formatPrice(price: PlanPrice): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: price.currency, maximumFractionDigits: price.amount % 1 === 0 ? 0 : 2 }).format(price.amount);
  } catch {
    return `${price.amount} ${price.currency}`;
  }
}
