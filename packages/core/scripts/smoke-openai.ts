import "dotenv/config";

import { OpenAIExtractor } from "../src/ai/extractor.js";
import { createLogger } from "../src/logger.js";

async function main() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    console.error("FAILED: OPENAI_API_KEY is not configured.");
    process.exitCode = 1;
    return;
  }

  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";

  const extractor = OpenAIExtractor.fromKey(
    apiKey,
    model,
    Number(process.env.AI_TIMEOUT_MS || 15000),
    createLogger("info", "openai-live-test")
  );

  const result = await extractor.extract(
    {
      subject: "Application deadline",
      body: "Please submit the completed application by November 10, 2026 at 5 PM IST.",
      fromAddress: "admissions@example.com",
      fromName: "Admissions Office",
      receivedAt: new Date(),
    },
    {
      timezone: "Asia/Kolkata",
    }
  );

  if (result.extractor !== `openai:${model}`) {
    console.error("LIVE OPENAI TEST FAILED");
    console.error("Provider used:", result.extractor);
    process.exitCode = 1;
    return;
  }

  console.log("\nLIVE OPENAI TEST PASSED");
  console.log("Provider:", result.extractor);
  console.log("Category:", result.result.category);
  console.log(
    "Extracted deadline:",
    result.result.deadline.deadlineAt?.toISOString() ?? "None"
  );
  console.log("Confidence:", result.result.confidence);
}

main().catch((error) => {
  console.error("LIVE OPENAI TEST FAILED");
  console.error(error instanceof Error ? error.message : "Unknown error");
  process.exitCode = 1;
});
