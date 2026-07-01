import { Bot } from "grammy";
import { config } from "./config.js";
import { supplyOtp } from "./auth.js";
import { handleIncomingSms } from "./handler.js";

let bot: Bot | null = null;

export function startTelegramBot(): void {
  if (!config.telegram.botToken) {
    console.log("[telegram] TELEGRAM_BOT_TOKEN not set, skipping Telegram bot");
    return;
  }

  bot = new Bot(config.telegram.botToken);

  bot.command("start", (ctx) =>
    ctx.reply(
      "🏠 Rent Agent ready!\n\n" +
        "Send a message to create a maintenance request:\n" +
        '• "leaky faucet in bathroom"\n' +
        '• "pest control"\n' +
        '• "status" — check login state\n' +
        '• "login" — trigger re-authentication\n' +
        '• "help" — show commands'
    )
  );

  bot.on("message:text", async (ctx) => {
    const chatId = ctx.chat.id.toString();

    // Fail closed: reject all messages if TELEGRAM_CHAT_ID is not configured
    if (!config.telegram.chatId) {
      console.warn(`[telegram] TELEGRAM_CHAT_ID not set — rejecting message from chat ${chatId}. Set TELEGRAM_CHAT_ID=${chatId} in .env to authorize.`);
      await ctx.reply("Bot is not configured yet. Ask the admin to set TELEGRAM_CHAT_ID.");
      return;
    }

    // Only respond to the authorized user
    if (chatId !== config.telegram.chatId) {
      console.warn(`[telegram] Rejected message from unauthorized chat: ${chatId}`);
      return;
    }

    const text = ctx.message.text.trim();
    const isOtp = /^\d{4,8}$/.test(text);
    console.log(`[telegram] Received message from ${chatId} (${isOtp ? "OTP" : text.length + " chars"})`);

    // Check if this is an OTP code
    if (isOtp) {
      console.log("[telegram] Detected OTP code, supplying to auth flow...");
      supplyOtp(text);
      await ctx.reply("Code received, logging in...");
      return;
    }

    await ctx.reply("⏳ Processing your request...");

    try {
      const reply = await handleIncomingSms(text, `telegram:${chatId}`);
      await ctx.reply(reply);
    } catch (err) {
      console.error("[telegram] Error handling message:", err);
      await ctx.reply("Something went wrong. Please try again.");
    }
  });

  bot.start();
  console.log("[telegram] Bot started, listening for messages");
}

export async function sendTelegram(message: string): Promise<void> {
  if (!config.telegram.botToken || !config.telegram.chatId) {
    console.log(`[telegram] (not configured) Would send: ${message}`);
    return;
  }

  try {
    const b = bot ?? new Bot(config.telegram.botToken);
    await b.api.sendMessage(config.telegram.chatId, message);
    console.log("[telegram] Message sent");
  } catch (err) {
    console.error("[telegram] Failed to send message:", err);
  }
}

export function stopTelegramBot(): void {
  if (bot) {
    bot.stop();
    bot = null;
  }
}
