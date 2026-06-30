/**
 * Interactive login script — run this first to authenticate with RentCafe.
 *
 * Usage:  npm run login
 *
 * Opens a visible browser window so you can:
 *   1. Solve the Cloudflare challenge manually
 *   2. Enter your email (auto-filled if RENTCAFE_EMAIL is set)
 *   3. Enter the OTP code from your email
 *
 * Once logged in, cookies are saved to browser-data/cookies.json for future use.
 */

import { launchBrowser, getPage, saveCookies, isLoggedIn, closeBrowser } from "./browser.js";
import { config } from "./config.js";
import readline from "node:readline";

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function interactiveLogin(): Promise<void> {
  console.log("=== RentCafe Interactive Login ===\n");
  console.log("This will open a browser window. You may need to:");
  console.log("  1. Solve a Cloudflare captcha");
  console.log("  2. Enter your verification code\n");

  await launchBrowser();
  const page = await getPage();

  console.log(`Navigating to: ${config.rentcafe.url}`);
  await page.goto(config.rentcafe.url, { waitUntil: "domcontentloaded", timeout: 30_000 });

  // Wait for user to handle Cloudflare
  console.log("\nIf there's a Cloudflare challenge, please solve it in the browser window.");
  await prompt("Press Enter once you're past the Cloudflare check...");

  // Auto-fill email if configured
  if (config.rentcafe.email) {
    console.log(`\nFilling email: ${config.rentcafe.email}`);
    const emailInput = await page.$(
      'input[type="email"], input[name*="email" i], input[id*="email" i], input[type="text"]'
    );
    if (emailInput) {
      await emailInput.fill(config.rentcafe.email);
      console.log("Email filled. Click 'Sign In' or 'Send Code' in the browser.");
    }
  }

  await prompt("Press Enter once you've submitted your email...");

  // Wait for OTP
  const otp = await prompt("Enter the verification code from your email: ");
  if (otp) {
    const otpInput = await page.$(
      'input[name*="code" i], input[name*="otp" i], input[name*="verification" i], input[type="tel"], input[type="number"], input:visible'
    );
    if (otpInput) {
      await otpInput.fill(otp);
      console.log("Code entered. Click 'Verify' or 'Submit' in the browser.");
    }
  }

  await prompt("Press Enter once you're fully logged in...");

  // Verify login
  if (await isLoggedIn(page)) {
    console.log("\nLogin successful! Saving cookies...");
  } else {
    console.log("\nCouldn't confirm login status, but saving cookies anyway...");
  }

  await saveCookies();
  console.log("Cookies saved to browser-data/cookies.json");
  console.log("\nYou can now start the agent with: npm run dev");

  await closeBrowser();
  process.exit(0);
}

interactiveLogin().catch((err) => {
  console.error("Login error:", err);
  process.exit(1);
});
