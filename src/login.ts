/**
 * Interactive login script — run this first to authenticate with RentCafe.
 *
 * Usage:  npm run login
 *
 * Creates a Browserbase session (with captcha solving + persistent context),
 * navigates to RentCafe, and walks you through the OTP login flow.
 * Cookies are automatically persisted via Browserbase contexts.
 */

import { launchBrowser, getPage, closeBrowser, isLoggedIn } from "./browser.js";
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
  console.log("=== RentCafe Interactive Login (via Browserbase) ===\n");
  console.log("Browserbase will handle Cloudflare challenges automatically.");
  console.log("Cookies are persisted across sessions via Browserbase contexts.\n");

  await launchBrowser();
  const page = await getPage();

  console.log(`Navigating to: ${config.rentcafe.url}`);
  await page.goto(config.rentcafe.url, { waitUntil: "networkidle", timeout: 60_000 });

  // Wait a moment for any Cloudflare challenge to be solved
  await page.waitForTimeout(5000);

  // Check if already logged in from a previous session
  if (await isLoggedIn(page)) {
    console.log("\nAlready logged in from a previous session!");
    await closeBrowser();
    process.exit(0);
  }

  // Auto-fill email if configured
  if (config.rentcafe.email) {
    console.log(`\nFilling email: ${config.rentcafe.email}`);
    const emailInput = await page.$(
      'input[type="email"], input[name*="email" i], input[id*="email" i], input[type="text"]'
    );
    if (emailInput) {
      await emailInput.fill(config.rentcafe.email);
    }
  }

  // Click submit to trigger OTP
  const submitBtn = await page.$(
    'button[type="submit"], input[type="submit"], button:has-text("Sign In"), button:has-text("Log In"), button:has-text("Continue"), button:has-text("Send Code")'
  );
  if (submitBtn) {
    await submitBtn.click();
    console.log("Email submitted, OTP should be sent to your email.");
  } else {
    await prompt("Click 'Sign In' or 'Send Code' in the browser, then press Enter here...");
  }

  await page.waitForTimeout(3000);

  // Wait for OTP from user
  const otp = await prompt("\nEnter the verification code from your email: ");
  if (otp) {
    const otpInput = await page.$(
      'input[name*="code" i], input[name*="otp" i], input[name*="verification" i], input[type="tel"], input[type="number"]'
    );
    if (otpInput) {
      await otpInput.fill(otp);
    } else {
      // Try first visible input on the page
      const visibleInputs = await page.$$("input:visible");
      if (visibleInputs.length > 0) {
        await visibleInputs[0].fill(otp);
      }
    }

    // Submit OTP
    const otpSubmit = await page.$(
      'button[type="submit"], input[type="submit"], button:has-text("Verify"), button:has-text("Submit"), button:has-text("Continue")'
    );
    if (otpSubmit) {
      await otpSubmit.click();
    } else {
      await page.keyboard.press("Enter");
    }
  }

  await page.waitForTimeout(5000);

  if (await isLoggedIn(page)) {
    console.log("\nLogin successful! Cookies saved via Browserbase context.");
  } else {
    console.log("\nCouldn't confirm login, but cookies are saved via Browserbase context.");
  }

  console.log("You can now start the agent with: npm run dev\n");
  await closeBrowser();
  process.exit(0);
}

interactiveLogin().catch((err) => {
  console.error("Login error:", err);
  process.exit(1);
});
