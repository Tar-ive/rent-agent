/**
 * Interactive login script — run this first to authenticate with RentCafe.
 *
 * Usage:  npm run login
 *
 * Creates a Browserbase session (with captcha solving + persistent context),
 * navigates to RentCafe, and walks you through the OTP login flow.
 * Cookies are automatically persisted via Browserbase contexts.
 */

import type { Page } from "playwright";
import { launchBrowser, getPage, closeBrowser, isLoggedIn, getContextId } from "./browser.js";
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

async function clickOrPrompt(page: Page, selector: string, promptText: string): Promise<void> {
  const btn = await page.$(selector);
  if (btn) {
    await btn.click();
  } else {
    await prompt(promptText);
  }
}

async function interactiveLogin(): Promise<void> {
  console.log("=== RentCafe Interactive Login (via Browserbase) ===\n");
  console.log("Browserbase will handle Cloudflare challenges automatically.");
  console.log("Cookies are persisted across sessions via Browserbase contexts.\n");

  await launchBrowser();
  const page = await getPage();

  console.log(`Navigating to: ${config.rentcafe.url}`);
  await page.goto(config.rentcafe.url, { waitUntil: "domcontentloaded", timeout: 60_000 });

  // Wait for Cloudflare to resolve
  console.log("Waiting for Cloudflare challenge to resolve...");
  await page.waitForTimeout(10_000);

  // Check if already logged in from a previous session
  if (await isLoggedIn(page)) {
    console.log("\nAlready logged in from a previous session!");
    await closeBrowser();
    process.exit(0);
  }

  // Step 1: Click "Continue with Email"
  console.log('\nClicking "Continue with Email"...');
  const emailBtn = await page.$(
    'button:has-text("Continue with Email"), a:has-text("Continue with Email")'
  );
  if (emailBtn) {
    await emailBtn.click();
    await page.waitForTimeout(3000);
  } else {
    console.log("No 'Continue with Email' button found, looking for email input directly...");
  }

  // Step 2: Fill email (sequential selectors, most specific first)
  if (config.rentcafe.email) {
    console.log("Filling email...");
    const emailInput =
      (await page.$('input[type="email"]')) ??
      (await page.$('input[name*="email" i]')) ??
      (await page.$('input[id*="email" i]')) ??
      (await page.$('input[type="text"]'));
    if (emailInput) {
      await emailInput.fill(config.rentcafe.email);
    }
  } else {
    await prompt("Enter your email in the browser, then press Enter here...");
  }

  // Step 3: Submit to trigger OTP
  await clickOrPrompt(
    page,
    'button[type="submit"]:visible, button:has-text("Continue"):visible, button:has-text("Sign In"):visible, button:has-text("Send Code"):visible',
    "Click 'Continue' or 'Sign In' in the browser, then press Enter here..."
  );
  console.log("Email submitted, OTP should be sent to your email.");

  await page.waitForTimeout(3000);

  // Step 4: Enter OTP (sequential selectors for OTP field)
  const otp = await prompt("\nEnter the verification code from your email: ");
  if (otp) {
    const otpInput =
      (await page.$('input[name*="code" i]')) ??
      (await page.$('input[name*="otp" i]')) ??
      (await page.$('input[name*="verification" i]')) ??
      (await page.$('input[id*="code" i]')) ??
      (await page.$('input[id*="otp" i]')) ??
      (await page.$('input[type="tel"]')) ??
      (await page.$('input[type="number"]'));
    if (otpInput) {
      await otpInput.fill(otp);
    } else {
      // Fallback: find a visible input that isn't the email field
      const visibleInputs = await page.$$("input:visible");
      for (const input of visibleInputs) {
        const type = (await input.getAttribute("type"))?.toLowerCase() ?? "";
        const name = (await input.getAttribute("name"))?.toLowerCase() ?? "";
        if (type === "email" || name.includes("email")) continue;
        if (type === "hidden" || type === "checkbox" || type === "radio") continue;
        await input.fill(otp);
        break;
      }
    }

    await clickOrPrompt(
      page,
      'button:has-text("Verify"):visible, button[type="submit"]:visible, button:has-text("Submit"):visible, button:has-text("Continue"):visible',
      "Click 'Verify' or 'Submit' in the browser, then press Enter here..."
    );
  }

  await page.waitForTimeout(5000);

  if (await isLoggedIn(page)) {
    console.log("\nLogin successful! Cookies saved via Browserbase context.");
  } else {
    console.log("\nCouldn't confirm login, but cookies are saved via Browserbase context.");
  }

  const ctxId = getContextId();
  if (ctxId) {
    console.log(`\nSave this context ID in your .env for future sessions:`);
    console.log(`BROWSERBASE_CONTEXT_ID=${ctxId}`);
  }

  console.log("\nYou can now start the agent with: npm run dev\n");
  await closeBrowser();
  process.exit(0);
}

interactiveLogin().catch((err) => {
  console.error("Login error:", err);
  process.exit(1);
});
