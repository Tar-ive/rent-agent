/**
 * Interactive login script — run this first to authenticate with RentCafe.
 *
 * Usage:  npm run login
 *
 * Creates a Browserbase session (with captcha solving + persistent context),
 * navigates to RentCafe, and walks you through the OTP login flow.
 * Cookies are automatically persisted via Browserbase contexts.
 */

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

  // Step 2: Fill email
  if (config.rentcafe.email) {
    console.log(`Filling email: ${config.rentcafe.email}`);
    const emailInput = await page.$(
      'input[type="email"], input[name*="email" i], input[id*="email" i], input[type="text"]'
    );
    if (emailInput) {
      await emailInput.fill(config.rentcafe.email);
    }
  } else {
    await prompt("Enter your email in the browser, then press Enter here...");
  }

  // Step 3: Submit to trigger OTP
  const submitBtn = await page.$(
    'button[type="submit"], input[type="submit"], button:has-text("Continue"), button:has-text("Sign In"), button:has-text("Send Code")'
  );
  if (submitBtn) {
    await submitBtn.click();
    console.log("Email submitted, OTP should be sent to your email.");
  } else {
    await prompt("Click 'Continue' or 'Sign In' in the browser, then press Enter here...");
  }

  await page.waitForTimeout(3000);

  // Step 4: Enter OTP
  const otp = await prompt("\nEnter the verification code from your email: ");
  if (otp) {
    const otpInput = await page.$(
      'input[name*="code" i], input[name*="otp" i], input[name*="verification" i], input[type="tel"], input[type="number"]'
    );
    if (otpInput) {
      await otpInput.fill(otp);
    } else {
      const visibleInputs = await page.$$("input:visible");
      if (visibleInputs.length > 0) {
        await visibleInputs[0].fill(otp);
      }
    }

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
