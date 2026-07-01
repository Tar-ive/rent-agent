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
 *   1. Open an auth URL — visit it and authorize
 *   2. Paste the authorization code back here
 *   3. Output a GMAIL_REFRESH_TOKEN to add to your .env
 */

import { google } from "googleapis";
import readline from "node:readline";
import { config } from "./config.js";

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main(): Promise<void> {
  if (!config.gmail.clientId || !config.gmail.clientSecret) {
    console.error("Error: Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in .env first.");
    console.error("\nSteps:");
    console.error("1. Go to https://console.cloud.google.com/apis/credentials");
    console.error("2. Create OAuth2 credentials (Desktop application)");
    console.error("3. Enable Gmail API at https://console.cloud.google.com/apis/library/gmail.googleapis.com");
    console.error("4. Add GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET to your .env file");
    process.exit(1);
  }

  const oauth2 = new google.auth.OAuth2(
    config.gmail.clientId,
    config.gmail.clientSecret,
    "urn:ietf:wg:oauth:2.0:oob"
  );

  const authUrl = oauth2.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.modify"],
    prompt: "consent",
  });

  console.log("=== Gmail OAuth2 Setup ===\n");
  console.log("1. Open this URL in your browser:\n");
  console.log(authUrl);
  console.log();

  const code = await prompt("2. Paste the authorization code here: ");

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

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
