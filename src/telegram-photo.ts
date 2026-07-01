/**
 * Standalone Telegram photo sender — no grammy dependency.
 * Used by GitHub Actions dispatch scripts to send confirmation screenshots.
 */

import { config } from "./config.js";

/**
 * Send a photo with caption to the configured Telegram chat.
 * Returns true on success, false otherwise (never throws).
 */
export async function sendTelegramPhoto(caption: string, photo: Buffer): Promise<boolean> {
  if (!config.telegram.botToken || !config.telegram.chatId) {
    console.log("[telegram-photo] Telegram not configured, skipping photo");
    return false;
  }

  try {
    const form = new FormData();
    form.append("chat_id", config.telegram.chatId);
    form.append("caption", caption.slice(0, 1024)); // Telegram caption limit
    form.append("photo", new Blob([new Uint8Array(photo)], { type: "image/png" }), "confirmation.png");

    const res = await fetch(`https://api.telegram.org/bot${config.telegram.botToken}/sendPhoto`, {
      method: "POST",
      body: form,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[telegram-photo] sendPhoto failed (${res.status}): ${body}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[telegram-photo] Error sending photo:", err);
    return false;
  }
}
