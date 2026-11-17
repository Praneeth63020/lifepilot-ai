/**
 * FAQ shown on the landing page. Answers describe only what exists today; anything that depends on
 * server configuration (the support address) is resolved at render time.
 */

export interface FaqContext {
  /** Public support address from GET /api/v1/config, or null when none is configured. */
  supportEmail: string | null;
}

export interface FaqItem {
  id: string;
  question: string;
  /** Paragraphs of the answer. */
  answer: (ctx: FaqContext) => string[];
}

export const FAQ: FaqItem[] = [
  {
    id: "what",
    question: "What is LifePilot AI?",
    answer: () => [
      "LifePilot AI is a personal life manager. It brings your tasks, projects, calendar, important emails and reminders into one place, then helps you decide what matters today and builds a realistic plan around the time you actually have.",
    ],
  },
  {
    id: "how",
    question: "How does LifePilot work?",
    answer: () => [
      "You add tasks yourself and, if you choose, connect Gmail and Google Calendar. LifePilot looks for important messages and commitments, suggests tasks for you to approve, and builds a daily plan that fits your top priorities between calendar events, inside your working hours, with breaks and preparation time.",
      "Reminders then nudge you before things start and when they're due. Nothing is created from an email until you approve it, and an accepted plan never changes silently — LifePilot tells you when it's out of date and lets you replan.",
    ],
  },
  {
    id: "gmail-required",
    question: "Do I need to connect Gmail?",
    answer: () => [
      "No. Tasks, projects, the daily planner, the calendar and reminders all work without Gmail. Connecting it adds the smart inbox, which spots deadlines and requests in recent emails.",
    ],
  },
  {
    id: "calendar-optional",
    question: "Is Google Calendar integration optional?",
    answer: () => [
      "Yes. Without it you can still plan your day and add events in LifePilot. When connected, your Google events are shown read-only so the planner can schedule around them — LifePilot never edits your Google Calendar.",
    ],
  },
  {
    id: "deadlines",
    question: "How does AI find deadlines?",
    answer: () => [
      "For each synced email, LifePilot extracts structured details — what's being asked, the due date and time, and the exact sentence it came from — then checks the result against the email text. It notices when a deadline has changed, when an email mentions several dates, and when a date is unclear (those are marked \"needs confirmation\").",
      "Email content is treated as data, never as instructions: messages that try to instruct an AI are flagged for you. If you switch AI analysis off, a built-in rule engine is used instead and nothing is sent to an AI provider. Either way, you approve a suggestion before any task is created.",
    ],
  },
  {
    id: "manual",
    question: "Can I add tasks manually?",
    answer: () => [
      "Yes — that's the core of LifePilot. Add tasks with priorities, due dates, tags, subtasks and recurrence, group them into projects, and search or filter them any time.",
    ],
  },
  {
    id: "reminders",
    question: "How do reminders work?",
    answer: () => [
      "LifePilot can remind you to prepare before something starts and again when it's due. You can snooze reminders and set quiet hours so nothing interrupts you at night.",
      "While LifePilot is open, reminders play one of three LifePilot sounds. With browser push turned on you're notified even when the tab is closed; push notifications use your device's system sound.",
    ],
  },
  {
    id: "disconnect",
    question: "Can I disconnect my accounts?",
    answer: () => [
      "Yes, at any time from Settings. When you disconnect Gmail or Google Calendar you can also choose to delete everything that was imported from it. You can export all your data or delete your account from Settings too.",
    ],
  },
  {
    id: "subscription",
    question: "How can I manage my subscription?",
    answer: () => [
      "Billing isn't live yet, so there's no subscription to manage: no card is needed and nothing is charged. Before billing starts, plans, prices, renewal and cancellation terms will be published, and you'll be able to manage them from your account.",
    ],
  },
  {
    id: "support",
    question: "How can I contact support?",
    answer: ({ supportEmail }) =>
      supportEmail
        ? [`Email us at ${supportEmail}. Include the email address you signed up with and a short description of what happened.`]
        : ["A dedicated support contact is coming soon. In the meantime, Settings lets you export or delete your data and disconnect any account yourself."],
  },
];
