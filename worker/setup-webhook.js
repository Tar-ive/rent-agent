/**
 * Register Telegram webhook pointing to your Cloudflare Worker URL.
 *
 * Usage:
 *   TELEGRAM_BOT_TOKEN=xxx WORKER_URL=https://rent-agent-telegram.YOUR_SUBDOMAIN.workers.dev node setup-webhook.js
 */

const token = process.env.TELEGRAM_BOT_TOKEN;
const workerUrl = process.env.WORKER_URL;

if (!token || !workerUrl) {
  console.error("Usage: TELEGRAM_BOT_TOKEN=xxx WORKER_URL=https://your-worker.workers.dev node setup-webhook.js");
  process.exit(1);
}

async function main() {
  // Set webhook
  const setUrl = `https://api.telegram.org/bot${token}/setWebhook?url=${encodeURIComponent(workerUrl)}`;
  const res = await fetch(setUrl);
  const data = await res.json();
  console.log("setWebhook:", data);

  // Verify
  const infoUrl = `https://api.telegram.org/bot${token}/getWebhookInfo`;
  const info = await fetch(infoUrl).then((r) => r.json());
  console.log("Webhook info:", JSON.stringify(info.result, null, 2));
}

main().catch(console.error);
