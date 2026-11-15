/**
 * Live OpenAI smoke test: exactly ONE request to the Responses API, with a synthetic email.
 *
 *   pnpm smoke:openai
 *
 * - Retries are disabled (maxRetries: 0) and requests are counted, so a 429/5xx can't turn into
 *   several billable calls.
 * - The email is synthetic (no personal data). The API key is never printed.
 * - It passes only if the model really answered AND the result is correct: the deadline must be
 *   20 Nov 2026 17:00 Asia/Kolkata, quoted from the email, with a required action.
 * Cost: one short request (a few hundred tokens) on the configured model.
 */
import "dotenv/config";
import OpenAI from "openai";
import { DateTime } from "luxon";
import { OpenAIExtractor, type OpenAILike } from "../src/ai/extractor.js";
import { createLogger } from "../src/logger.js";

const TZ = "Asia/Kolkata";
const EMAIL = {
  subject: "Assignment submission deadline",
  body: "Please submit your Chemical Engineering assignment by November 20, 2026 at 5 PM IST.",
  fromAddress: "professor@university.example",
  fromName: "Course Instructor",
  receivedAt: new Date("2026-11-15T04:30:00Z"),
};
const EXPECTED_DEADLINE = DateTime.fromISO("2026-11-20T17:00", { zone: TZ }).toJSDate();

async function main() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    console.error("FAILED: OPENAI_API_KEY is not configured.");
    process.exitCode = 1;
    return;
  }
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const timeoutMs = Number(process.env.AI_TIMEOUT_MS || 15000);

  let requests = 0;
  const sdk = new OpenAI({ apiKey, maxRetries: 0 });
  const client: OpenAILike = {
    responses: {
      create(body, opts) {
        requests++;
        return sdk.responses.create(body as never, opts) as unknown as Promise<{ output_text?: string }>;
      },
    },
  };
  const extractor = new OpenAIExtractor(client, model, timeoutMs, createLogger("warn", "openai-live-test"));

  console.log(`Model: ${model} · timeout ${timeoutMs} ms · one request, no retries`);
  const { result, extractor: provider } = await extractor.extract(EMAIL, { timezone: TZ });

  const d = result.deadline;
  const checks: [string, boolean, string][] = [
    ["Exactly one API request", requests === 1, `${requests} request(s)`],
    ["Answered by OpenAI (no fallback)", provider === `openai:${model}`, provider],
    ["Category is deadline-related", ["deadline", "urgent", "work_education", "requires_action"].includes(result.category), result.category],
    ["Required action extracted", Boolean(result.requiredAction), result.requiredAction ?? "none"],
    ["Deadline is explicit", d.certainty === "explicit", d.certainty],
    [
      "Deadline = 20 Nov 2026, 17:00 Asia/Kolkata",
      d.deadlineAt?.getTime() === EXPECTED_DEADLINE.getTime(),
      d.deadlineAt ? DateTime.fromJSDate(d.deadlineAt, { zone: TZ }).toFormat("ccc d LLL yyyy, HH:mm ZZZZ") : "none",
    ],
    ["Deadline quoted from the email", Boolean(d.deadlineText && EMAIL.body.toLowerCase().includes(d.deadlineText.toLowerCase())), d.deadlineText ?? "none"],
    ["No other deadline invented", !d.alsoMentioned?.length, d.alsoMentioned?.join(", ") || "none"],
    ["Not flagged as suspicious", !result.suspicious, String(result.suspicious)],
  ];
  for (const [name, ok, detail] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
  console.log(`Summary: ${result.summary}`);
  console.log(`Confidence: ${result.confidence}`);

  const passed = checks.every(([, ok]) => ok);
  console.log(passed ? "\nLIVE OPENAI TEST PASSED" : "\nLIVE OPENAI TEST FAILED");
  if (!passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error("LIVE OPENAI TEST FAILED");
  // Error messages from the SDK never include the key; print only the message.
  console.error(error instanceof Error ? error.message : "Unknown error");
  process.exitCode = 1;
});
