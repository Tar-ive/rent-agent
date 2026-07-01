import { Bot, type Context } from "grammy";
import { config } from "./config.js";
import { supplyOtp } from "./auth.js";
import { handleIncomingSms } from "./handler.js";
import {
  getSession,
  setSession,
  clearSession,
  getCategoryOptions,
  resolveCategory,
  getLocationOptions,
  resolveLocation,
  formatSummary,
} from "./conversation.js";
import fs from "node:fs";
import path from "node:path";

let bot: Bot | null = null;

const PHOTOS_DIR = path.resolve("temp-photos");

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

  // Handle photo messages
  bot.on("message:photo", async (ctx) => {
    const chatId = ctx.chat.id.toString();
    if (!isAuthorized(ctx, chatId)) return;

    const state = getSession(chatId);

    if (state.step !== "awaiting_photos") {
      await ctx.reply(
        "Got a photo! To include it in a maintenance request, start by describing the issue first.\n" +
          'e.g. "leaky faucet in kitchen"'
      );
      return;
    }

    // Download the photo (largest size)
    const photos = ctx.message.photo;
    const largest = photos[photos.length - 1];
    const file = await ctx.api.getFile(largest.file_id);
    const filePath = file.file_path;

    if (!filePath) {
      await ctx.reply("Could not download photo. Try sending again.");
      return;
    }

    // Download to temp directory
    fs.mkdirSync(PHOTOS_DIR, { recursive: true });
    const localPath = path.join(PHOTOS_DIR, `${Date.now()}-${path.basename(filePath)}`);
    const url = `https://api.telegram.org/file/bot${config.telegram.botToken}/${filePath}`;

    try {
      const response = await fetch(url);
      const buffer = Buffer.from(await response.arrayBuffer());
      fs.writeFileSync(localPath, buffer);

      const updatedPhotos = [...state.photos, localPath];
      setSession(chatId, { ...state, photos: updatedPhotos });

      await ctx.reply(
        `Photo ${updatedPhotos.length} saved. Send more photos, or type 'done' to continue.`
      );
    } catch (err) {
      console.error("[telegram] Failed to download photo:", err);
      await ctx.reply("Failed to download photo. Try again.");
    }
  });

  bot.on("message:text", async (ctx) => {
    const chatId = ctx.chat.id.toString();
    if (!isAuthorized(ctx, chatId)) return;

    const text = ctx.message.text.trim();
    const isOtp = /^\d{4,8}$/.test(text);
    console.log(`[telegram] Received message from ${chatId} (${isOtp ? "OTP" : text.length + " chars"})`);

    // OTP codes always take priority
    if (isOtp) {
      console.log("[telegram] Detected OTP code, supplying to auth flow...");
      supplyOtp(text);
      await ctx.reply("Code received, logging in...");
      return;
    }

    // Check if user wants to cancel an in-progress conversation
    if (text.toLowerCase() === "cancel") {
      const state = getSession(chatId);
      if (state.step !== "idle") {
        clearSession(chatId);
        await ctx.reply("Request cancelled.");
        return;
      }
    }

    // Handle conversation state
    const state = getSession(chatId);

    if (state.step !== "idle") {
      await handleConversationStep(ctx, chatId, text, state);
      return;
    }

    // Non-interactive commands pass through to existing handler
    const lower = text.toLowerCase();
    if (
      lower === "help" || lower === "?" || lower === "/help" ||
      lower === "status" || lower === "/status" ||
      lower === "login" || lower === "/login" ||
      lower === "workflows" || lower === "/workflows"
    ) {
      const reply = await handleIncomingSms(text, `telegram:${chatId}`);
      await ctx.reply(reply);
      return;
    }

    // Start interactive flow for maintenance/pest requests
    await startInteractiveRequest(ctx, chatId, text);
  });

  bot.start();
  console.log("[telegram] Bot started, listening for messages");
}

function isAuthorized(ctx: Context, chatId: string): boolean {
  if (!config.telegram.chatId) {
    console.warn(
      `[telegram] TELEGRAM_CHAT_ID not set — rejecting message from chat ${chatId}. Set TELEGRAM_CHAT_ID=${chatId} in .env to authorize.`
    );
    void ctx.reply("Bot is not configured yet. Ask the admin to set TELEGRAM_CHAT_ID.");
    return false;
  }
  if (chatId !== config.telegram.chatId) {
    console.warn(`[telegram] Rejected message from unauthorized chat: ${chatId}`);
    return false;
  }
  return true;
}

async function startInteractiveRequest(ctx: Context, chatId: string, description: string): Promise<void> {
  // If the message clearly identifies a pest control request, shortcut
  const lower = description.toLowerCase();
  if (lower.includes("pest") || lower.includes("bug spray") || lower.includes("exterminator")) {
    setSession(chatId, {
      step: "awaiting_location",
      description,
      category: "pest control",
    });
    await ctx.reply(
      `Got it: pest control request.\n\nWhich area?\n${getLocationOptions()}\n\nOr type a custom location:`
    );
    return;
  }

  // Ask for category
  setSession(chatId, { step: "awaiting_category", description });
  await ctx.reply(
    `Got it: "${description}"\n\nWhat category?\n${getCategoryOptions()}\n\nPick a number or type it:`
  );
}

async function handleConversationStep(
  ctx: Context,
  chatId: string,
  text: string,
  state: Exclude<ReturnType<typeof getSession>, { step: "idle" }>
): Promise<void> {
  switch (state.step) {
    case "awaiting_category": {
      const category = resolveCategory(text);
      if (!category) {
        await ctx.reply(`Didn't recognize that. Pick a number:\n${getCategoryOptions()}`);
        return;
      }
      setSession(chatId, {
        step: "awaiting_location",
        description: state.description,
        category,
      });
      await ctx.reply(
        `Category: ${category}\n\nWhich area?\n${getLocationOptions()}\n\nPick a number or type it:`
      );
      break;
    }

    case "awaiting_location": {
      const location = resolveLocation(text) ?? text.trim();
      setSession(chatId, {
        step: "awaiting_photos",
        description: state.description,
        category: state.category,
        location,
        photos: [],
      });
      await ctx.reply(
        `Location: ${location}\n\nWant to attach photos? Send them now, or type 'done' to skip.`
      );
      break;
    }

    case "awaiting_photos": {
      if (text.toLowerCase() === "done" || text.toLowerCase() === "skip" || text.toLowerCase() === "no") {
        const confirmState = {
          step: "awaiting_confirm" as const,
          description: state.description,
          category: state.category,
          location: state.location,
          photos: state.photos,
        };
        setSession(chatId, confirmState);
        await ctx.reply(formatSummary(confirmState));
        return;
      }
      await ctx.reply("Send photos, or type 'done' to continue without photos.");
      break;
    }

    case "awaiting_confirm": {
      const lower = text.toLowerCase();
      if (lower === "yes" || lower === "y" || lower === "submit" || lower === "confirm") {
        clearSession(chatId);
        await ctx.reply("Submitting your request...");

        try {
          const reply = await handleIncomingSms(
            state.description,
            `telegram:${chatId}`,
            {
              category: state.category,
              location: state.location,
              photos: state.photos,
            }
          );
          await ctx.reply(reply);
        } catch (err) {
          console.error("[telegram] Error submitting:", err);
          await ctx.reply("Something went wrong submitting the request. Try again.");
        }

        // Cleanup temp photos
        for (const photo of state.photos) {
          try { fs.unlinkSync(photo); } catch { /* best-effort */ }
        }
        return;
      }

      if (lower === "no" || lower === "cancel") {
        clearSession(chatId);
        // Cleanup temp photos
        for (const photo of state.photos) {
          try { fs.unlinkSync(photo); } catch { /* best-effort */ }
        }
        await ctx.reply("Request cancelled.");
        return;
      }

      await ctx.reply("Send 'yes' to submit or 'cancel' to discard.");
      break;
    }
  }
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
