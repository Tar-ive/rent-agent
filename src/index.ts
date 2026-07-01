import { launchBrowser, closeBrowser } from "./browser.js";
import { config } from "./config.js";
import { startServer } from "./server.js";
import { startTelegramBot, stopTelegramBot } from "./telegram.js";
import { startScheduler } from "./scheduler.js";

async function main(): Promise<void> {
  console.log("=== Rent Agent ===");
  console.log("Automated maintenance & pest control for RentCafe\n");

  // Launch browser with saved cookies
  await launchBrowser();
  console.log("[main] Browser launched");

  // Start Telegram bot (preferred) or SMS webhook server
  if (config.telegram.botToken) {
    startTelegramBot();
  } else {
    startServer();
  }

  // Start the weekly pest control scheduler
  startScheduler();

  console.log("\n[main] Agent is ready!");
  if (config.telegram.botToken) {
    console.log("[main] - Message the Telegram bot to create maintenance requests");
  } else {
    console.log("[main] - Send an SMS to create maintenance requests");
  }
  console.log("[main] - Pest control requests are scheduled automatically");
  console.log("[main] - Run `npm run login` first if you haven't authenticated yet\n");

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\n[main] Shutting down...");
    stopTelegramBot();
    await closeBrowser();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  process.on("unhandledRejection", (reason) => {
    console.error("[main] Unhandled rejection:", reason);
    void shutdown();
  });
  process.on("uncaughtException", (err) => {
    console.error("[main] Uncaught exception:", err);
    void shutdown();
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
