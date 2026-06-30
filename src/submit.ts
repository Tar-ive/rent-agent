/**
 * One-shot maintenance request submission from the command line.
 *
 * Usage:  npm run submit -- "leaky faucet in kitchen"
 *         npm run submit -- "pest control"
 */

import { launchBrowser, getPage, closeBrowser } from "./browser.js";
import { handleIncomingSms } from "./handler.js";

async function main(): Promise<void> {
  const message = process.argv.slice(2).join(" ").trim();
  if (!message) {
    console.error("Usage: npm run submit -- \"description of your maintenance request\"");
    process.exit(1);
  }

  console.log(`[submit] Request: "${message}"`);

  await launchBrowser();
  const result = await handleIncomingSms(message, "cli");
  console.log(`[submit] Result: ${result}`);

  await closeBrowser();
  process.exit(0);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
