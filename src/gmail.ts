import { google } from "googleapis";
import { config } from "./config.js";

const POLL_INTERVAL = 10_000; // 10 seconds
const MAX_POLL_DURATION = 5 * 60_000; // 5 minutes

function getGmailClient() {
  const oauth2 = new google.auth.OAuth2(
    config.gmail.clientId,
    config.gmail.clientSecret
  );
  oauth2.setCredentials({ refresh_token: config.gmail.refreshToken });
  return google.gmail({ version: "v1", auth: oauth2 });
}

export function isGmailConfigured(): boolean {
  return !!(config.gmail.clientId && config.gmail.clientSecret && config.gmail.refreshToken);
}

export async function pollForOtp(cutoffTimestamp?: number): Promise<string | null> {
  if (!isGmailConfigured()) {
    console.log("[gmail] Gmail API not configured, skipping auto-OTP");
    return null;
  }

  const gmail = getGmailClient();
  const startTime = Date.now();

  // Use provided cutoff (from before OTP was triggered) or fall back to now
  const afterTimestamp = cutoffTimestamp ?? Math.floor(startTime / 1000);

  console.log("[gmail] Polling for OTP email...");

  while (Date.now() - startTime < MAX_POLL_DURATION) {
    try {
      const query = `from:${config.gmail.otpSender} after:${afterTimestamp} is:unread`;
      const res = await gmail.users.messages.list({
        userId: "me",
        q: query,
        maxResults: 5,
      });

      const messages = res.data.messages;
      if (messages && messages.length > 0) {
        // Check newest message first
        for (const msg of messages) {
          if (!msg.id) continue;
          const full = await gmail.users.messages.get({
            userId: "me",
            id: msg.id,
            format: "full",
          });

          const body = extractBody(full.data);
          const otp = extractOtp(body);

          if (otp) {
            console.log("[gmail] OTP found in email");
            // Mark as read
            await gmail.users.messages.modify({
              userId: "me",
              id: msg.id,
              requestBody: { removeLabelIds: ["UNREAD"] },
            });
            return otp;
          }
        }
      }
    } catch (err) {
      console.error("[gmail] Poll error:", err);
    }

    await sleep(POLL_INTERVAL);
  }

  console.log("[gmail] OTP poll timed out");
  return null;
}

function extractBody(message: { payload?: { body?: { data?: string | null } | null; parts?: Array<{ mimeType?: string | null; body?: { data?: string | null } | null }> | null } | null }): string {
  const payload = message.payload;
  if (!payload) return "";

  // Simple message with body directly
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, "base64url").toString("utf-8");
  }

  // Multipart message — look for text/plain or text/html
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return Buffer.from(part.body.data, "base64url").toString("utf-8");
      }
    }
    for (const part of payload.parts) {
      if (part.mimeType === "text/html" && part.body?.data) {
        return Buffer.from(part.body.data, "base64url").toString("utf-8");
      }
    }
  }

  return "";
}

function extractOtp(text: string): string | null {
  // Common OTP patterns: "Your code is 123456", "Verification code: 7890", standalone 4-8 digit numbers
  const patterns = [
    /(?:code|otp|pin|verification|verify)[:\s]+(\d{4,8})/i,
    /(\d{4,8})\s*(?:is your|is the)/i,
    /\b(\d{6})\b/, // standalone 6-digit (most common OTP length)
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }

  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
