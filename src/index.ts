import { launchBrowser, closeBrowser } from "./browser.js";
import { startServer } from "./server.js";
import { startScheduler } from "./scheduler.js";

async function main(): Promise<void> {
  console.log("=== Rent Agent ===");
  console.log("Automated maintenance & pest control for RentCafe\n");

  // Launch browser with saved cookies
  await launchBrowser();
  console.log("[main] Browser launched");

  // Start the SMS webhook server
  startServer();

  // Start the weekly pest control scheduler
  startScheduler();

  console.log("\n[main] Agent is ready!");
  console.log("[main] - Send an SMS to create maintenance requests");
  console.log("[main] - Pest control requests are scheduled automatically");
  console.log("[main] - Run `npm run login` first if you haven't authenticated yet\n");

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\n[main] Shutting down...");
    await closeBrowser();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
