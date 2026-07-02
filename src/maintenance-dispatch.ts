/**
 * CLI entry point for GitHub Actions dispatch (multi-user).
 * Reads REQUEST_DESCRIPTION, USER_CHAT_ID, CONTEXT_ID from env.
 * Submits work order using the user's persistent context, notifies via Telegram.
 */

import { submitMaintenanceRequest } from "./maintenance-action.js";
import { config } from "./config.js";
import { sendTelegramPhoto } from "./telegram-photo.js";
import * as https from "https";

const description: string = process.env.REQUEST_DESCRIPTION ?? "";
if (!description) {
  console.error("Missing REQUEST_DESCRIPTION env var");
  process.exit(1);
}

const userChatId: string = process.env.USER_CHAT_ID?.trim() || config.telegram.chatId;
const contextId: string = process.env.CONTEXT_ID?.trim() || "";

function sendTelegram(text: string, chatId?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      chat_id: chatId ?? userChatId,
      text,
    });
    const options = {
      hostname: "api.telegram.org",
      path: `/bot${config.telegram.botToken}/sendMessage`,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
    };
    const req = https.request(options, (res) => {
      res.on("data", () => {});
      res.on("end", resolve);
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  console.log(`[dispatch] Submitting maintenance request: "${description}"`);
  if (contextId) {
    console.log(`[dispatch] Using context: ${contextId.substring(0, 8)}...`);
  }
  console.log(`[dispatch] Notifying chat: ${userChatId}`);

  const result = await submitMaintenanceRequest(description, { contextId: contextId || undefined });

  if (result.success) {
    const msg = `✅ Work order submitted${result.requestId ? ` (ID: ${result.requestId})` : ""}!\n\n"${description}"`;
    console.log(`[dispatch] ${msg}`);
    const photoSent = result.screenshot
      ? await sendTelegramPhoto(msg, result.screenshot, userChatId)
      : false;
    if (!photoSent) await sendTelegram(msg);
  } else {
    const msg = `❌ Work order failed: ${result.error}\n\nRequest: "${description}"`;
    console.error(`[dispatch] ${msg}`);
    await sendTelegram(msg);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
