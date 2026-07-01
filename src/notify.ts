import { config } from "./config.js";
import { sendTelegram } from "./telegram.js";

export async function sendNotification(message: string): Promise<void> {
  // Prefer Telegram, fall back to Twilio SMS, fall back to console
  if (config.telegram.botToken && config.telegram.chatId) {
    await sendTelegram(message);
    return;
  }

  if (config.twilio.accountSid && config.twilio.phoneNumber && config.userPhoneNumber) {
    const { sendSms } = await import("./sms.js");
    await sendSms(message);
    return;
  }

  console.log(`[notify] (no channel configured) ${message}`);
}
