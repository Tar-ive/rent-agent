import cron from "node-cron";
import { config } from "./config.js";
import { submitPestControl } from "./pest-control.js";
import { sendNotification } from "./notify.js";

export function startScheduler(): void {
  const cronExpr = config.pestControlCron;

  if (!cron.validate(cronExpr)) {
    console.error(`[scheduler] Invalid cron expression: ${cronExpr}`);
    return;
  }

  cron.schedule(cronExpr, async () => {
    console.log("[scheduler] Running weekly pest control job...");
    try {
      const result = await submitPestControl();
      if (result.success) {
        const msg = `[Scheduled] Pest control submitted${result.requestId ? ` (ID: ${result.requestId})` : ""}`;
        console.log(`[scheduler] ${msg}`);
        await sendNotification(msg);
      } else {
        const msg = `[Scheduled] Pest control FAILED: ${result.error}`;
        console.error(`[scheduler] ${msg}`);
        await sendNotification(msg);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[scheduler] Pest control error:", msg);
      await sendNotification(`[Scheduled] Pest control error: ${msg}`);
    }
  });

  console.log(`[scheduler] Weekly pest control scheduled: ${cronExpr} (every Monday 9 AM)`);
}
