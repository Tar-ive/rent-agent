import type { Page } from "playwright";
import { config } from "./config.js";
import { saveCookies, isLoggedIn } from "./browser.js";
import { sendNotification } from "./notify.js";
import { isGmailConfigured, pollForOtp as gmailPollForOtp } from "./gmail.js";

const LOGIN_TIMEOUT = 5 * 60_000; // 5 minutes to wait for OTP

export async function login(page: Page): Promise<boolean> {
  console.log("[auth] Navigating to login page...");
  await page.goto(config.rentcafe.url, { waitUntil: "domcontentloaded", timeout: 60_000 });

  // Wait for Cloudflare to resolve (Browserbase handles this automatically)
  await page.waitForTimeout(10_000);

  // Check if we're already logged in (cookies were valid)
  if (await isLoggedIn(page)) {
    console.log("[auth] Already logged in via saved cookies");
    return true;
  }

  // Step 1: Click "Continue with Email" button
  console.log("[auth] Clicking 'Continue with Email'...");
  const emailBtn = await page.$(
    'button:has-text("Continue with Email"), a:has-text("Continue with Email")'
  );
  if (emailBtn) {
    await emailBtn.click();
    await page.waitForTimeout(3000);
  }

  // Step 2: Fill email field (sequential selectors, most specific first)
  console.log("[auth] Filling email...");
  const emailInput =
    (await page.$('input[type="email"]')) ??
    (await page.$('input[name*="email" i]')) ??
    (await page.$('input[id*="email" i]')) ??
    (await page.$('input[type="text"]'));
  if (emailInput) {
    await emailInput.fill(config.rentcafe.email);
  } else {
    console.error("[auth] Could not find email input field");
    return false;
  }

  // Step 3: Click submit/continue to trigger OTP (scope to visible buttons only)
  const submitBtn =
    (await page.$('button[type="submit"]:visible')) ??
    (await page.$('button:has-text("Send Code"):visible')) ??
    (await page.$('button:has-text("Continue"):visible')) ??
    (await page.$('button:has-text("Sign In"):visible')) ??
    (await page.$('button:has-text("Log In"):visible'));
  if (submitBtn) {
    await submitBtn.click();
    console.log("[auth] Submitted email, waiting for OTP...");
  } else {
    await page.keyboard.press("Enter");
    console.log("[auth] Pressed Enter to submit email");
  }

  // Register OTP waiter BEFORE the delay so early replies are captured
  const manualOtpPromise = waitForOtp();

  await page.waitForTimeout(3000);

  let otp: string | null = null;

  if (isGmailConfigured()) {
    // Auto-read OTP from Gmail — fully hands-free
    console.log("[auth] Gmail API configured — auto-reading OTP from inbox...");
    await sendNotification("RentCafe login triggered — reading OTP from Gmail automatically...");
    otp = await gmailPollForOtp();
  }

  if (!otp) {
    // Fall back to manual OTP entry via Telegram/SMS
    await sendNotification("RentCafe login: check your email for a verification code and reply with it here.");
    console.log("[auth] Waiting for OTP code via message...");
    otp = await manualOtpPromise;
  }

  if (!otp) {
    console.error("[auth] No OTP received within timeout");
    await sendNotification("Login timed out — no verification code received. Please try again.");
    return false;
  }

  console.log("[auth] OTP received, entering code...");

  // Step 5: Fill OTP field (sequential selectors, exclude email-like inputs)
  const otpInput =
    (await page.$('input[name*="code" i]')) ??
    (await page.$('input[name*="otp" i]')) ??
    (await page.$('input[name*="verification" i]')) ??
    (await page.$('input[id*="code" i]')) ??
    (await page.$('input[id*="otp" i]')) ??
    (await page.$('input[id*="verification" i]'));
  if (otpInput) {
    await otpInput.fill(otp);
  } else {
    // Fallback: find a visible input that is NOT the email field
    const visibleInputs = await page.$$("input:visible");
    const nonEmailInput = await findNonEmailInput(visibleInputs);
    if (nonEmailInput) {
      await nonEmailInput.fill(otp);
    } else {
      console.error("[auth] Could not find OTP input field");
      return false;
    }
  }

  // Step 6: Submit OTP (scope to visible buttons in the current step)
  const otpSubmit =
    (await page.$('button:has-text("Verify"):visible')) ??
    (await page.$('button:has-text("Submit"):visible')) ??
    (await page.$('button[type="submit"]:visible')) ??
    (await page.$('button:has-text("Continue"):visible')) ??
    (await page.$('button:has-text("Sign In"):visible'));
  if (otpSubmit) {
    await otpSubmit.click();
  } else {
    await page.keyboard.press("Enter");
  }

  // Wait for navigation after OTP
  await page.waitForTimeout(5000);

  if (await isLoggedIn(page)) {
    console.log("[auth] Login successful!");
    await saveCookies();
    await sendNotification("Successfully logged into RentCafe.");
    return true;
  }

  console.error("[auth] Login may have failed — check the browser");
  return false;
}

async function findNonEmailInput(inputs: Awaited<ReturnType<Page["$$"]>>): Promise<Awaited<ReturnType<Page["$"]>>> {
  for (const input of inputs) {
    const type = (await input.getAttribute("type"))?.toLowerCase() ?? "";
    const name = (await input.getAttribute("name"))?.toLowerCase() ?? "";
    const id = (await input.getAttribute("id"))?.toLowerCase() ?? "";
    if (type === "email" || name.includes("email") || id.includes("email")) continue;
    if (type === "hidden" || type === "checkbox" || type === "radio") continue;
    return input;
  }
  return null;
}

// --- OTP exchange mechanism ---

let pendingOtpResolve: ((value: string | null) => void) | null = null;

export function supplyOtp(code: string): void {
  if (pendingOtpResolve) {
    pendingOtpResolve(code);
    pendingOtpResolve = null;
  }
}

function waitForOtp(): Promise<string | null> {
  return new Promise((resolve) => {
    pendingOtpResolve = resolve;
    setTimeout(() => {
      if (pendingOtpResolve === resolve) {
        pendingOtpResolve = null;
        resolve(null);
      }
    }, LOGIN_TIMEOUT);
  });
}
