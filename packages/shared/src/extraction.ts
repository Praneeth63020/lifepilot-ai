/**
 * Rule-based email insight extraction (the deterministic "mock" AI provider).
 * Also used to validate and constrain output from a real model:
 *  - injection detection always runs here, regardless of provider
 *  - a model-supplied deadline is only accepted if its quoted text appears in the email
 *
 * Email content is UNTRUSTED. Nothing in this module (or anywhere) executes instructions
 * found inside an email; text that tries to instruct an AI only raises `suspicious`.
 */
import { DateTime } from "luxon";

export const EMAIL_CATEGORIES = [
  "urgent",
  "requires_action",
  "deadline",
  "meeting",
  "work_education",
  "financial",
  "travel",
  "informational",
  "low_priority",
] as const;
export type EmailCategory = (typeof EMAIL_CATEGORIES)[number];
export type DeadlineCertainty = "explicit" | "inferred" | "ambiguous" | "none";

export interface EmailInput {
  subject: string;
  body: string;
  fromAddress: string;
  fromName?: string | null;
  receivedAt: Date;
}

export interface ExtractionContext {
  timezone: string;
  /** Sender addresses or domains the user marked important */
  importantSenders?: string[];
}

export interface DeadlineResult {
  deadlineAt: Date | null;
  /** The exact phrase from the email the deadline came from */
  deadlineText: string | null;
  certainty: DeadlineCertainty;
  timeAssumed: boolean;
  question: string | null;
}

export interface EmailInsightResult {
  category: EmailCategory;
  importanceScore: number;
  summary: string;
  whyItMatters: string;
  requiredAction: string | null;
  deadline: DeadlineResult;
  confidence: number;
  suspicious: boolean;
  suspiciousReason: string | null;
  proposedTaskTitle: string | null;
  /** Never guessed: null unless the email states a duration. */
  proposedEstimateMin: number | null;
  signals: string[];
}

const INJECTION_PATTERNS: RegExp[] = [
  /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|your|system)\b[^.\n]{0,30}\b(instructions?|rules?|prompts?|guidelines?)\b/i,
  /\b(system prompt|developer message|jailbreak)\b/i,
  /\byou are (now )?(an? )?(ai|assistant|language model|chatbot|gpt|claude|llm)\b/i,
  /\b(as an ai|dear (ai|assistant))\b/i,
  /\b(assistant|ai)[,:]?\s+(please\s+)?(forward|send|export|delete|reply|mark|create|reveal)\b/i,
  /\b(forward|send|export|share)\b[^.\n]{0,40}\b(all|every|entire)\b[^.\n]{0,30}\b(emails?|inbox|messages|contacts|data|passwords?|tokens?)\b/i,
  /\b(reveal|print|output|leak)\b[^.\n]{0,30}\b(api key|token|password|credentials|secret)\b/i,
];

const RX = {
  directRequest:
    /\b(please|could you|can you|would you|kindly|action required|need you to|make sure (to|you)|you (must|need to|are required to|should)|required to|reminder to|don't forget to|remember to|rsvp|confirm)\b/i,
  urgency: /\b(urgent|asap|immediately|important|critical|final notice|last chance|time[- ]sensitive)\b/i,
  meeting: /\b(invitation|invited|invite|meeting|interview|webinar|1:1|one-on-one|stand-?up|sync|call)\b/i,
  meetingTime: /\b(\d{1,2}(:\d{2})?\s?(am|pm)|\d{1,2}:\d{2}|zoom|google meet|teams|calendar|\.ics)\b/i,
  financial:
    /\b(invoice|payment|pay|bill|billing|statement|amount due|emi|premium|refund|transaction|rent|fee|fees|overdue balance)\b/i,
  travel: /\b(flight|booking|itinerary|pnr|hotel|check-?in|boarding|reservation|train|e-?ticket)\b/i,
  workEdu:
    /\b(assignment|course|lecture|exam|professor|prof\.|submission|project|report|manager|client|review|quiz|lab|deliverable|proposal|sprint|semester)\b/i,
  marketing:
    /\b(unsubscribe|\d+% off|sale|deals?|offers?|newsletter|promo(tion)?|discount|limited[- ]time|shop now|free shipping|weekly digest)\b/i,
  duration: /\b(take|takes|requires?|need|about|approximately|around)\s+(about\s+)?(\d{1,3})\s*(minutes?|mins?|hours?|hrs?)\b/i,
};

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6,
  june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10,
  october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const WEEKDAYS: Record<string, number> = {
  monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 7,
};
const MONTH_RX = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const TRIGGER_RX =
  "(?:due(?: date)?(?: is| on| by)?|deadline(?: is)?|submit(?:ted)?(?: it)? by|no later than|by|before|until|expires?(?: on)?|closes?(?: on)?|respond by|reply by|pay by)";
const TIME_RX = "(?:,?\\s*(?:at|by|before)?\\s*(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm|a\\.m\\.|p\\.m\\.)|,?\\s*(?:at|by)\\s*(\\d{1,2}):(\\d{2})|,?\\s*(?:at|by)?\\s*(noon|midnight))?";
const VAGUE_RX =
  /\b(as soon as possible|asap|soon|shortly|at your earliest convenience|end of (the )?(week|month)|in (a|the) (few|next few) days|next week|eod|end of (the )?day)\b/i;

function zoned(tz: string, y: number, m: number, d: number, hh: number, mm: number): DateTime {
  return DateTime.fromObject({ year: y, month: m, day: d, hour: hh, minute: mm }, { zone: tz });
}

function parseTime(groups: (string | undefined)[]): { hh: number; mm: number } | null {
  const [h12, m12, ampm, h24, m24, word] = groups;
  if (word) return word.toLowerCase() === "noon" ? { hh: 12, mm: 0 } : { hh: 23, mm: 59 };
  if (h12 && ampm) {
    let hh = Number(h12) % 12;
    if (ampm.toLowerCase().startsWith("p")) hh += 12;
    const mm = m12 ? Number(m12) : 0;
    if (hh > 23 || mm > 59) return null;
    return { hh, mm };
  }
  if (h24 && m24) {
    const hh = Number(h24);
    const mm = Number(m24);
    if (hh > 23 || mm > 59) return null;
    return { hh, mm };
  }
  return null;
}

export function extractDeadline(text: string, receivedAt: Date, tz: string): DeadlineResult {
  const none: DeadlineResult = { deadlineAt: null, deadlineText: null, certainty: "none", timeAssumed: false, question: null };
  const received = DateTime.fromJSDate(receivedAt, { zone: tz });

  const finish = (
    dt: DateTime | null,
    phrase: string,
    certainty: DeadlineCertainty,
    time: { hh: number; mm: number } | null,
  ): DeadlineResult => {
    if (!dt || !dt.isValid) {
      return { deadlineAt: null, deadlineText: phrase.trim(), certainty: "ambiguous", timeAssumed: false, question: `When exactly is this due? The email says "${phrase.trim()}".` };
    }
    const withTime = time ? dt.set({ hour: time.hh, minute: time.mm }) : dt.set({ hour: 23, minute: 59 });
    return { deadlineAt: withTime.toJSDate(), deadlineText: phrase.trim(), certainty, timeAssumed: !time, question: null };
  };

  // 1) ISO date
  let m = new RegExp(`${TRIGGER_RX}:?\\s*(\\d{4})-(\\d{2})-(\\d{2})${TIME_RX}`, "i").exec(text);
  if (m) {
    return finish(zoned(tz, +m[1]!, +m[2]!, +m[3]!, 0, 0), m[0], "explicit", parseTime(m.slice(4)));
  }

  // 2) "Nov 3", "November 3rd, 2026", optionally preceded by a weekday
  m = new RegExp(
    `${TRIGGER_RX}:?\\s*(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\\s+)?(?:the\\s+)?${MONTH_RX}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?${TIME_RX}`,
    "i",
  ).exec(text);
  if (m) {
    const month = MONTHS[m[1]!.toLowerCase().replace(".", "")]!;
    const day = +m[2]!;
    let year = m[3] ? +m[3] : received.year;
    let dt = zoned(tz, year, month, day, 0, 0);
    if (!m[3] && dt < received.minus({ days: 30 })) dt = zoned(tz, ++year, month, day, 0, 0);
    return finish(dt, m[0], "explicit", parseTime(m.slice(4)));
  }

  // 3) "3 Nov", "3rd of November 2026"
  m = new RegExp(
    `${TRIGGER_RX}:?\\s*(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\\s+)?(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RX}\\.?(?:,?\\s+(\\d{4}))?${TIME_RX}`,
    "i",
  ).exec(text);
  if (m) {
    const month = MONTHS[m[2]!.toLowerCase().replace(".", "")]!;
    const day = +m[1]!;
    let year = m[3] ? +m[3] : received.year;
    let dt = zoned(tz, year, month, day, 0, 0);
    if (!m[3] && dt < received.minus({ days: 30 })) dt = zoned(tz, ++year, month, day, 0, 0);
    return finish(dt, m[0], "explicit", parseTime(m.slice(4)));
  }

  // 4) Numeric d/m/y or m/d/y — ambiguous when both parts could be a month.
  m = new RegExp(`${TRIGGER_RX}:?\\s*(\\d{1,2})[/.](\\d{1,2})[/.](\\d{2,4})${TIME_RX}`, "i").exec(text);
  if (m) {
    const a = +m[1]!;
    const b = +m[2]!;
    const year = m[3]!.length === 2 ? 2000 + +m[3]! : +m[3]!;
    if (a <= 12 && b <= 12 && a !== b) {
      return {
        deadlineAt: null,
        deadlineText: m[0].trim(),
        certainty: "ambiguous",
        timeAssumed: false,
        question: `"${m[0].trim()}" could mean ${a}/${b} as day/month or month/day. Which date is it?`,
      };
    }
    const [day, month] = a > 12 ? [a, b] : [b, a];
    return finish(zoned(tz, year, month, day, 0, 0), m[0], "explicit", parseTime(m.slice(4)));
  }

  // 5) Weekday: "by Friday", "due this Friday" → inferred; "next Friday" → ambiguous.
  m = new RegExp(`${TRIGGER_RX}:?\\s*(this |next |coming )?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)${TIME_RX}`, "i").exec(text);
  if (m) {
    const qualifier = (m[1] ?? "").trim().toLowerCase();
    if (qualifier === "next") {
      return {
        deadlineAt: null,
        deadlineText: m[0].trim(),
        certainty: "ambiguous",
        timeAssumed: false,
        question: `The email says "${m[0].trim()}". Which date does it mean?`,
      };
    }
    const target = WEEKDAYS[m[2]!.toLowerCase()]!;
    const delta = (target - received.weekday + 7) % 7;
    const dt = received.startOf("day").plus({ days: delta });
    return finish(dt, m[0], "inferred", parseTime(m.slice(3)));
  }

  // 6) today / tonight / tomorrow → inferred relative to when the email was received.
  m = new RegExp(`${TRIGGER_RX}:?\\s*(today|tonight|tomorrow)${TIME_RX}`, "i").exec(text);
  if (m) {
    const word = m[1]!.toLowerCase();
    const dt = received.startOf("day").plus({ days: word === "tomorrow" ? 1 : 0 });
    return finish(dt, m[0], "inferred", parseTime(m.slice(2)));
  }

  // 7) Vague timing near a request → ambiguous, ask the user. Never invent a date.
  const vague = VAGUE_RX.exec(text);
  if (vague && (RX.directRequest.test(text) || /\b(due|deadline|submit)\b/i.test(text))) {
    return {
      deadlineAt: null,
      deadlineText: vague[0],
      certainty: "ambiguous",
      timeAssumed: false,
      question: `The email asks for this "${vague[0]}" without a date. When do you want it done?`,
    };
  }

  return none;
}

export function detectInjection(text: string): string | null {
  for (const rx of INJECTION_PATTERNS) {
    const m = rx.exec(text);
    if (m) return m[0].slice(0, 120);
  }
  return null;
}

function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function clip(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + "…";
}

export function cleanSubject(subject: string): string {
  return subject.replace(/^\s*((re|fwd?|fw)\s*:\s*)+/i, "").trim() || "(no subject)";
}

function senderImportant(from: string, list: string[] = []): boolean {
  const f = from.toLowerCase();
  return list.some((entry) => {
    const e = entry.toLowerCase().trim();
    return e && (f === e || f.endsWith(e.startsWith("@") ? e : `@${e}`));
  });
}

export function extractEmailInsight(email: EmailInput, ctx: ExtractionContext): EmailInsightResult {
  const text = `${email.subject}\n${email.body}`;
  const signals: string[] = [];
  const why: string[] = [];

  const injection = detectInjection(text);
  const deadline = extractDeadline(text, email.receivedAt, ctx.timezone);
  const direct = RX.directRequest.test(text);
  const urgency = RX.urgency.test(text);
  const meeting = RX.meeting.test(email.subject) || (RX.meeting.test(text) && RX.meetingTime.test(text));
  const financial = RX.financial.test(text);
  const travel = RX.travel.test(text);
  const workEdu = RX.workEdu.test(text);
  const marketing = RX.marketing.test(text);
  const vip = senderImportant(email.fromAddress, ctx.importantSenders);

  let score = 10;
  if (deadline.certainty === "explicit") { score += 30; signals.push("explicit_deadline"); }
  else if (deadline.certainty === "inferred") { score += 22; signals.push("inferred_deadline"); }
  else if (deadline.certainty === "ambiguous") { score += 12; signals.push("ambiguous_deadline"); }
  if (direct) { score += 20; signals.push("direct_request"); why.push("Asks you to do something"); }
  if (meeting) { score += 15; signals.push("meeting"); why.push("Meeting or invitation"); }
  if (financial) { score += 15; signals.push("financial"); why.push("Involves a payment or bill"); }
  if (travel) { score += 10; signals.push("travel"); why.push("Travel or booking details"); }
  if (workEdu) { score += 5; signals.push("work_education"); }
  if (vip) { score += 20; signals.push("important_sender"); why.push("From a sender you marked important"); }
  // Alarming words only count when backed by a concrete signal.
  if (urgency && (deadline.certainty !== "none" || direct)) { score += 5; signals.push("urgency"); }
  if (marketing) { score -= 25; signals.push("marketing"); }
  score = Math.max(0, Math.min(100, score));

  if (deadline.deadlineAt) {
    const label = DateTime.fromJSDate(deadline.deadlineAt, { zone: ctx.timezone }).toFormat("ccc d LLL, h:mm a");
    why.unshift(
      `Deadline ${label}${deadline.certainty === "inferred" ? " (worked out from the email's date)" : ""}${deadline.timeAssumed ? " — no time given, end of day assumed" : ""}`,
    );
  } else if (deadline.certainty === "ambiguous") {
    why.unshift(`Mentions timing ("${deadline.deadlineText}") but no clear date`);
  }

  const hoursToDeadline = deadline.deadlineAt
    ? (deadline.deadlineAt.getTime() - email.receivedAt.getTime()) / 3_600_000
    : Infinity;

  let category: EmailCategory;
  if (marketing && deadline.certainty === "none" && !direct && !vip) category = "low_priority";
  else if (meeting) category = "meeting";
  else if (deadline.deadlineAt && score >= 70 && hoursToDeadline <= 48) category = "urgent";
  else if (deadline.certainty !== "none") category = "deadline";
  else if (financial) category = "financial";
  else if (travel) category = "travel";
  else if (direct) category = "requires_action";
  else if (workEdu) category = "work_education";
  else category = marketing ? "low_priority" : "informational";

  const sents = sentences(email.body);
  const actionSentence = sents.find((s) => RX.directRequest.test(s) || /\b(due|deadline|submit)\b/i.test(s));
  const summarySource = sents.find((s) => !/^(hi|hello|hey|dear)\b/i.test(s) && s.length > 20) ?? sents[0] ?? email.subject;

  let confidence = 0.6;
  if (deadline.certainty === "explicit") confidence += 0.2;
  if (deadline.certainty === "inferred") confidence += 0.1;
  if (deadline.certainty === "ambiguous") confidence -= 0.1;
  if (direct) confidence += 0.05;
  if (marketing && category === "low_priority") confidence = 0.8;
  let suspiciousReason: string | null = null;
  if (injection) {
    suspiciousReason = `Contains text that tries to instruct an AI ("${clip(injection, 60)}"). It was ignored.`;
    confidence = Math.min(confidence, 0.35);
    why.push("Flagged: contains instructions aimed at an AI assistant — review manually");
  }
  confidence = Math.round(Math.max(0.05, Math.min(0.95, confidence)) * 100) / 100;

  const actionable =
    direct || deadline.certainty !== "none" || (financial && /\b(due|pay|overdue)\b/i.test(text));
  const durationMatch = RX.duration.exec(email.body);
  const proposedEstimateMin = durationMatch
    ? Math.min(600, +durationMatch[3]! * (/^h/i.test(durationMatch[4]!) ? 60 : 1))
    : null;

  return {
    category,
    importanceScore: score,
    summary: clip(summarySource, 180),
    whyItMatters: why.length ? why.join(". ") + "." : "No action or deadline detected.",
    requiredAction: actionable && actionSentence ? clip(actionSentence, 220) : null,
    deadline,
    confidence,
    suspicious: Boolean(injection),
    suspiciousReason,
    proposedTaskTitle: actionable ? clip(cleanSubject(email.subject), 120) : null,
    proposedEstimateMin,
    signals,
  };
}

/**
 * Guardrail for model output: keep a model-proposed deadline only if the phrase it
 * cites actually appears in the email and parses to the same instant (±1 min).
 */
export function verifyModelDeadline(
  email: EmailInput,
  tz: string,
  proposed: { deadlineText: string | null; deadlineAt: Date | null },
): DeadlineResult {
  const own = extractDeadline(`${email.subject}\n${email.body}`, email.receivedAt, tz);
  if (!proposed.deadlineAt || !proposed.deadlineText) return own;
  const haystack = `${email.subject}\n${email.body}`.toLowerCase().replace(/\s+/g, " ");
  const needle = proposed.deadlineText.toLowerCase().replace(/\s+/g, " ").trim();
  if (!needle || !haystack.includes(needle)) return own;
  if (own.deadlineAt && Math.abs(own.deadlineAt.getTime() - proposed.deadlineAt.getTime()) <= 60_000) return own;
  // Model cites real text we couldn't parse identically → keep as needing confirmation.
  return {
    deadlineAt: null,
    deadlineText: proposed.deadlineText,
    certainty: "ambiguous",
    timeAssumed: false,
    question: `The email mentions "${proposed.deadlineText}". Please confirm the exact date and time.`,
  };
}
