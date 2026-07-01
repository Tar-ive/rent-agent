/**
 * Cloudflare Worker — Telegram webhook handler.
 *
 * Receives messages from Telegram instantly, responds to simple commands,
 * and triggers GitHub Actions for automation tasks (pest control, maintenance).
 */

export interface Env {
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
  GITHUB_TOKEN: string;
  GITHUB_REPO: string; // e.g. "Tar-ive/rent-agent"
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: { id: number; first_name: string };
    chat: { id: number; type: string };
    date: number;
    text?: string;
  };
}

async function sendTelegramMessage(token: string, chatId: string, text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
  });
}

async function triggerGitHubAction(env: Env, eventType: string, payload: Record<string, string>): Promise<boolean> {
  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/dispatches`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      event_type: eventType,
      client_payload: payload,
    }),
  });
  return resp.status === 204;
}

function parseIntent(text: string): { type: string; description?: string } {
  const lower = text.toLowerCase().trim();

  if (lower === "/start" || lower === "/help" || lower === "help") {
    return { type: "help" };
  }
  if (lower === "/status" || lower === "status") {
    return { type: "status" };
  }
  if (lower.includes("pest") || lower.includes("bug spray") || lower.includes("exterminator")) {
    return { type: "pest_control" };
  }
  if (lower.length > 5) {
    return { type: "maintenance", description: text.trim() };
  }
  return { type: "unknown" };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("OK", { status: 200 });
    }

    const update: TelegramUpdate = await request.json();
    const message = update.message;

    if (!message?.text) {
      return new Response("OK", { status: 200 });
    }

    // Only respond to authorized user
    if (message.chat.id.toString() !== env.TELEGRAM_CHAT_ID) {
      return new Response("OK", { status: 200 });
    }

    const intent = parseIntent(message.text);

    switch (intent.type) {
      case "help":
        await sendTelegramMessage(
          env.TELEGRAM_BOT_TOKEN,
          env.TELEGRAM_CHAT_ID,
          "🏠 *RentCafe Maintenance Bot*\n\n" +
            "Send me a message to create a work order:\n" +
            "• `pest control` — weekly pest treatment\n" +
            "• Any text — maintenance request with your description\n" +
            "• `status` — check bot status\n\n" +
            "Examples:\n" +
            "• _leaky faucet in kitchen_\n" +
            "• _AC not cooling properly_\n" +
            "• _three sockets not working_"
        );
        break;

      case "status":
        await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, "✅ Bot is online and ready.");
        break;

      case "pest_control":
        await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, "🐛 Triggering pest control request...");
        const ok1 = await triggerGitHubAction(env, "pest_control", {});
        if (!ok1) {
          await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, "❌ Failed to trigger workflow. Check GitHub token permissions.");
        }
        break;

      case "maintenance":
        await sendTelegramMessage(
          env.TELEGRAM_BOT_TOKEN,
          env.TELEGRAM_CHAT_ID,
          `🔧 Processing: "${intent.description}"\nI'll notify you when submitted.`
        );
        const ok2 = await triggerGitHubAction(env, "maintenance_request", {
          description: intent.description!,
        });
        if (!ok2) {
          await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, "❌ Failed to trigger workflow. Check GitHub token permissions.");
        }
        break;

      default:
        await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, "❓ Didn't understand that. Send `help` for usage.");
    }

    return new Response("OK", { status: 200 });
  },
};
