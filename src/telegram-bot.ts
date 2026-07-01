/**
 * Telegram Bot - polls for messages and triggers maintenance requests.
 * Designed to run in GitHub Actions on a schedule (every 15 min).
 *
 * Flow:
 * 1. Check for new messages since last processed update
 * 2. Parse intent (pest control, maintenance request, status)
 * 3. If maintenance request: run the automation
 * 4. Send confirmation back via Telegram
 */

import { config } from "./config.js";
import { submitPestControl } from "./pest-control.js";
import * as fs from "fs";
import * as path from "path";
import * as https from "https";

const BOT_TOKEN = config.telegram.botToken;
const CHAT_ID = config.telegram.chatId;
const STATE_FILE = path.join(process.cwd(), ".telegram-state.json");

interface TelegramMessage {
  update_id: number;
  message: {
    message_id: number;
    from: { id: number; first_name: string };
    chat: { id: number };
    date: number;
    text?: string;
    photo?: Array<{ file_id: string }>;
  };
}

function telegramApi(method: string, body?: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const options = {
      hostname: "api.telegram.org",
      path: `/bot${BOT_TOKEN}/${method}`,
      method: data ? "POST" : "GET",
      headers: data
        ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }
        : {},
    };

    const req = https.request(options, (res) => {
      let responseData = "";
      res.on("data", (chunk) => (responseData += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(responseData));
        } catch {
          reject(new Error(`Invalid JSON: ${responseData.substring(0, 200)}`));
        }
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function sendMessage(text: string, markdown = false): Promise<void> {
  const body: Record<string, string> = { chat_id: CHAT_ID, text };
  if (markdown) body.parse_mode = "Markdown";
  await telegramApi("sendMessage", body);
}

function getLastUpdateId(): number {
  try {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    return state.lastUpdateId ?? 0;
  } catch {
    return 0;
  }
}

function saveLastUpdateId(id: number): void {
  fs.writeFileSync(STATE_FILE, JSON.stringify({ lastUpdateId: id }));
}

function parseIntent(text: string): { type: "pest_control" | "maintenance" | "status" | "help" | "unknown"; description?: string } {
  const lower = text.toLowerCase().trim();

  if (lower === "status" || lower === "/status") {
    return { type: "status" };
  }
  if (lower === "help" || lower === "/help" || lower === "/start") {
    return { type: "help" };
  }
  if (lower.includes("pest") || lower.includes("bug spray") || lower.includes("exterminator")) {
    return { type: "pest_control" };
  }
  // Anything else is a maintenance request with the text as description
  if (lower.length > 5) {
    return { type: "maintenance", description: text.trim() };
  }
  return { type: "unknown" };
}

async function handleMessage(msg: TelegramMessage["message"]): Promise<void> {
  const text = msg.text ?? "";
  const chatId = msg.chat.id;

  // Only respond to the authorized user
  if (chatId.toString() !== CHAT_ID) {
    console.log(`[bot] Ignoring message from unauthorized chat: ${chatId}`);
    return;
  }

  console.log(`[bot] Received: "${text}"`);
  const intent = parseIntent(text);

  switch (intent.type) {
    case "help":
      await sendMessage(
        "🏠 *RentCafe Maintenance Bot*\n\n" +
          "Send me a message to create a work order:\n" +
          "• `pest control` — weekly pest treatment\n" +
          "• Any other text — maintenance request with your description\n" +
          "• `status` — check bot status\n\n" +
          "Examples:\n" +
          "• _leaky faucet in kitchen_\n" +
          "• _AC not cooling properly_\n" +
          "• _pest control_",
        true
      );
      break;

    case "status":
      await sendMessage("✅ Bot is running. Send a message to create a work order.");
      break;

    case "pest_control":
      await sendMessage("🐛 Starting pest control request...");
      try {
        const result = await submitPestControl();
        if (result.success) {
          await sendMessage(`✅ Pest control submitted${result.requestId ? ` (ID: ${result.requestId})` : ""}!`);
        } else {
          await sendMessage(`❌ Pest control failed: ${result.error}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await sendMessage(`❌ Error: ${msg}`);
      }
      break;

    case "maintenance":
      await sendMessage(`🔧 Creating work order: "${intent.description}"\nProcessing...`);
      try {
        // Import and use the maintenance submission with custom description
        const { submitMaintenanceRequest } = await import("./maintenance-action.js");
        const result = await submitMaintenanceRequest(intent.description!);
        if (result.success) {
          await sendMessage(`✅ Work order submitted${result.requestId ? ` (ID: ${result.requestId})` : ""}!`);
        } else {
          await sendMessage(`❌ Work order failed: ${result.error}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await sendMessage(`❌ Error: ${msg}`);
      }
      break;

    default:
      await sendMessage("❓ I didn't understand that. Send `help` for usage info.");
  }
}

async function main(): Promise<void> {
  console.log("[bot] Checking for new Telegram messages...");

  const lastId = getLastUpdateId();
  const params = lastId ? `?offset=${lastId + 1}&timeout=0` : "?timeout=0";

  const response = await telegramApi(`getUpdates${params}`);
  if (!response.ok) {
    console.error("[bot] Telegram API error:", response);
    return;
  }

  const updates: TelegramMessage[] = response.result;
  if (updates.length === 0) {
    console.log("[bot] No new messages.");
    return;
  }

  console.log(`[bot] ${updates.length} new message(s)`);

  for (const update of updates) {
    if (update.message?.text) {
      await handleMessage(update.message);
    }
    saveLastUpdateId(update.update_id);
  }

  console.log("[bot] Done.");
}

// CLI entry point
main().catch((err) => {
  console.error("[bot] Fatal:", err);
  process.exit(1);
});
