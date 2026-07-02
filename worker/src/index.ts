/**
 * Cloudflare Worker — Telegram webhook handler (multi-user).
 *
 * Receives messages from Telegram instantly, responds to commands,
 * and triggers GitHub Actions for automation tasks.
 *
 * Supports multiple users via Cloudflare KV for session storage.
 */

export interface Env {
  TELEGRAM_BOT_TOKEN: string;
  GITHUB_TOKEN: string;
  GITHUB_REPO: string;
  BROWSERBASE_API_KEY?: string;
  BROWSERBASE_PROJECT_ID?: string;
  USERS?: KVNamespace; // Cloudflare KV for user data (optional until configured)
}

interface UserData {
  chatId: string;
  contextId: string; // Browserbase persistent context ID
  rentcafeEmail?: string;
  registeredAt: string;
  lastUsed?: string;
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

async function sendTelegramMessage(token: string, chatId: string, text: string, markdown = false): Promise<void> {
  const payload: Record<string, string> = { chat_id: chatId, text };
  if (markdown) payload.parse_mode = "Markdown";
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
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
      "User-Agent": "rent-agent-telegram-worker",
    },
    body: JSON.stringify({
      event_type: eventType,
      client_payload: payload,
    }),
  });
  if (resp.status !== 204) {
    const body = await resp.text().catch(() => "");
    console.error(`GitHub dispatch failed (${resp.status}): ${body}`);
    return false;
  }
  return true;
}

async function createBrowserbaseContext(env: Env): Promise<string> {
  const resp = await fetch("https://www.browserbase.com/v1/contexts", {
    method: "POST",
    headers: {
      "x-bb-api-key": env.BROWSERBASE_API_KEY!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ projectId: env.BROWSERBASE_PROJECT_ID! }),
  });
  if (!resp.ok) {
    const err = await resp.text().catch(() => "");
    throw new Error(`Failed to create context: ${resp.status} ${err}`);
  }
  const data: { id: string } = await resp.json();
  return data.id;
}

async function createBrowserbaseSession(env: Env, contextId: string): Promise<{ sessionId: string; connectUrl: string }> {
  const resp = await fetch("https://www.browserbase.com/v1/sessions", {
    method: "POST",
    headers: {
      "x-bb-api-key": env.BROWSERBASE_API_KEY!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      projectId: env.BROWSERBASE_PROJECT_ID!,
      browserSettings: { solveCaptchas: true },
      browserbaseContext: contextId,
    }),
  });
  if (!resp.ok) {
    const err = await resp.text().catch(() => "");
    throw new Error(`Failed to create session: ${resp.status} ${err}`);
  }
  const data: { id: string; connectUrl: string } = await resp.json();
  return { sessionId: data.id, connectUrl: data.connectUrl };
}

function parseIntent(text: string): { type: string; description?: string } {
  const lower = text.toLowerCase().trim();

  if (lower === "/start" || lower === "/help" || lower === "help") {
    return { type: "help" };
  }
  if (lower === "/register" || lower === "register") {
    return { type: "register" };
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

    const chatId = message.chat.id.toString();
    const intent = parseIntent(message.text);

    switch (intent.type) {
      case "help":
        await sendTelegramMessage(
          env.TELEGRAM_BOT_TOKEN,
          chatId,
          "🏠 *RentCafe Maintenance Bot*\n\n" +
            "*Getting started:*\n" +
            "• `/register` — set up your account (one-time)\n\n" +
            "*Commands:*\n" +
            "• `pest control` — request pest treatment\n" +
            "• Any text — maintenance request with your description\n" +
            "• `status` — check your registration\n\n" +
            "*Examples:*\n" +
            "• _leaky faucet in kitchen_\n" +
            "• _AC not cooling properly_\n" +
            "• _three sockets not working_",
          true
        );
        break;

      case "register":
        await handleRegister(env, chatId);
        break;

      case "status":
        await handleStatus(env, chatId);
        break;

      case "pest_control": {
        const user = env.USERS ? await env.USERS.get<UserData>(chatId, "json") : null;
        await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, "🐛 Triggering pest control request...");
        const ok = await triggerGitHubAction(env, "pest_control", {
          user_chat_id: chatId,
          context_id: user?.contextId ?? "",
        });
        if (!ok) {
          await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, "❌ Failed to trigger workflow. Please try again later.");
        } else if (env.USERS && user) {
          await env.USERS.put(chatId, JSON.stringify({ ...user, lastUsed: new Date().toISOString() }));
        }
        break;
      }

      case "maintenance": {
        const user = env.USERS ? await env.USERS.get<UserData>(chatId, "json") : null;
        await sendTelegramMessage(
          env.TELEGRAM_BOT_TOKEN,
          chatId,
          `🔧 Processing: "${intent.description}"\nI'll notify you when submitted.`
        );
        const ok = await triggerGitHubAction(env, "maintenance_request", {
          description: intent.description!,
          user_chat_id: chatId,
          context_id: user?.contextId ?? "",
        });
        if (!ok) {
          await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, "❌ Failed to trigger workflow. Please try again later.");
        } else if (env.USERS && user) {
          await env.USERS.put(chatId, JSON.stringify({ ...user, lastUsed: new Date().toISOString() }));
        }
        break;
      }

      default:
        await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, "❓ Didn't understand that. Send /help for usage.");
    }

    return new Response("OK", { status: 200 });
  },
};

async function handleRegister(env: Env, chatId: string): Promise<void> {
  if (!env.USERS || !env.BROWSERBASE_API_KEY || !env.BROWSERBASE_PROJECT_ID) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, "⚠️ Multi-user registration is not configured yet. Ask the bot admin to set up KV + Browserbase.");
    return;
  }

  // Check if already registered — reuse existing context
  const existing = await env.USERS!.get<UserData>(chatId, "json");
  const contextId = existing?.contextId ?? await (async () => {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, "🔄 Setting up your account... Creating a browser session for you to log in.");
    return await createBrowserbaseContext(env);
  })();

  if (existing) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, "🔄 Re-registering... Creating a new login session with your existing context.");
  }

  try {

    // Create a session with that context (live view enabled)
    const { sessionId } = await createBrowserbaseSession(env, contextId);

    // Build live view URL
    const liveViewUrl = `https://www.browserbase.com/sessions/${sessionId}/live`;

    // Save user data to KV (preserve original registeredAt if re-registering)
    const userData: UserData = {
      chatId,
      contextId,
      registeredAt: existing?.registeredAt ?? new Date().toISOString(),
    };
    await env.USERS!.put(chatId, JSON.stringify(userData));

    await sendTelegramMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      "✅ Browser session created!\n\n" +
        "📋 Steps to complete registration:\n" +
        "1. Open this link (expires in 10 min):\n" +
        liveViewUrl + "\n\n" +
        "2. Log in to RentCafe with your email\n" +
        "3. Complete any 2FA (Duo Mobile, etc.)\n" +
        "4. Once you see the dashboard, you're done!\n\n" +
        "Your login session will be saved. After this, just message me to create work orders — no login needed."
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Register failed for ${chatId}: ${msg}`);
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, "❌ Registration failed. Please try again or contact the bot admin.");
  }
}

async function handleStatus(env: Env, chatId: string): Promise<void> {
  if (!env.USERS) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, "⚠️ Multi-user features not configured yet.");
    return;
  }
  const user = await env.USERS.get<UserData>(chatId, "json");
  if (!user) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, "❌ Not registered. Send /register to get started.");
    return;
  }
  const since = new Date(user.registeredAt).toLocaleDateString();
  const lastUsed = user.lastUsed ? new Date(user.lastUsed).toLocaleDateString() : "never";
  await sendTelegramMessage(
    env.TELEGRAM_BOT_TOKEN,
    chatId,
    `✅ Registered since: ${since}\nLast used: ${lastUsed}\nContext: ${user.contextId.substring(0, 8)}...`
  );
}
