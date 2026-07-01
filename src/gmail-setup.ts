/**
 * Gmail OAuth2 setup helper — run this once to get a refresh token.
 *
 * Usage:  npm run gmail-setup
 *
 * Prerequisites:
 *   1. Go to https://console.cloud.google.com/apis/credentials
 *   2. Create an OAuth2 client (Desktop app type)
 *   3. Enable the Gmail API
 *   4. Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in .env
 *
 * This script will:
 *   1. Start a local server to receive the OAuth callback
 *   2. Open an auth URL — visit it and authorize
 *   3. Output a GMAIL_REFRESH_TOKEN to add to your .env
 */

import { google } from "googleapis";
import http from "node:http";
import { config } from "./config.js";

const LOOPBACK_PORT = 3456;
const REDIRECT_URI = `http://127.0.0.1:${LOOPBACK_PORT}`;

async function main(): Promise<void> {
  if (!config.gmail.clientId || !config.gmail.clientSecret) {
    console.error("Error: Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in .env first.");
    console.error("\nSteps:");
    console.error("1. Go to https://console.cloud.google.com/apis/credentials");
    console.error("2. Create OAuth2 credentials (Desktop application)");
    console.error("3. Enable Gmail API at https://console.cloud.google.com/apis/library/gmail.googleapis.com");
    console.error("4. Add GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET to your .env file");
    console.error(`5. Add ${REDIRECT_URI} as an Authorized redirect URI in your OAuth client`);
    process.exit(1);
  }

  const oauth2 = new google.auth.OAuth2(
    config.gmail.clientId,
    config.gmail.clientSecret,
    REDIRECT_URI
  );

  const authUrl = oauth2.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.modify"],
    prompt: "consent",
  });

  console.log("=== Gmail OAuth2 Setup ===\n");
  console.log("1. Open this URL in your browser:\n");
  console.log(authUrl);
  console.log("\n2. Authorize, then wait — the code will be captured automatically.\n");

  const code = await waitForAuthCode();

  const { tokens } = await oauth2.getToken(code);

  if (tokens.refresh_token) {
    console.log("\n=== Success! ===\n");
    console.log("Add this to your .env file:\n");
    console.log(`GMAIL_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log("\nThe agent will now auto-read OTP codes from your Gmail.");
  } else {
    console.error("\nNo refresh token received. Try revoking access and running again:");
    console.error("https://myaccount.google.com/permissions");
  }

  process.exit(0);
}

function waitForAuthCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${LOOPBACK_PORT}`);
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      if (error) {
        res.end("Authorization denied. You can close this window.");
        server.close();
        reject(new Error(`OAuth error: ${error}`));
        return;
      }

      if (code) {
        res.end("Authorization successful! You can close this window.");
        server.close();
        resolve(code);
        return;
      }

      res.end("Waiting for authorization...");
    });

    server.listen(LOOPBACK_PORT, "127.0.0.1", () => {
      console.log(`[gmail-setup] Listening on ${REDIRECT_URI} for OAuth callback...`);
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      reject(new Error("Timed out waiting for authorization"));
    }, 5 * 60_000);
  });
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
