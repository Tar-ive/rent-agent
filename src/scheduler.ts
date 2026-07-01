import cron from "node-cron";
import { config } from "./config.js";
import { submitPestControlRequest } from "./handler.js";

export function startScheduler(): void {
  const cronExpr = config.pestControlCron;

  if (!cron.validate(cronExpr)) {
    console.error(`[scheduler] Invalid cron expression: ${cronExpr}`);
    return;
  }

  cron.schedule(cronExpr, () => {
    submitPestControlRequest().catch((err) => {
      console.error("[scheduler] Pest control submission failed:", err);
    });
  });

  console.log(`[scheduler] Weekly pest control scheduled: ${cronExpr}`);
}
