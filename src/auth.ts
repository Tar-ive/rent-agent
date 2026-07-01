import type { Page } from "playwright";
import { config } from "./config.js";
import { saveCookies, isLoggedIn } from "./browser.js";
import { sendSms } from "./sms.js";

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

  // Step 2: Fill email field
  console.log("[auth] Filling email...");
  const emailInput = await page.$(
    'input[type="email"], input[name*="email" i], input[id*="email" i], input[type="text"]'
  );
  if (emailInput) {
    await emailInput.fill(config.rentcafe.email);
  } else {
    console.error("[auth] Could not find email input field");
    return false;
  }

  // Step 3: Click submit/continue to trigger OTP
  const submitBtn = await page.$(
    'button[type="submit"], input[type="submit"], button:has-text("Continue"), button:has-text("Sign In"), button:has-text("Send Code"), button:has-text("Log In")'
  );
  if (submitBtn) {
    await submitBtn.click();
    console.log("[auth] Submitted email, waiting for OTP...");
  } else {
    await page.keyboard.press("Enter");
    console.log("[auth] Pressed Enter to submit email");
  }

  await page.waitForTimeout(3000);

  // Step 4: Notify user via SMS that a code is needed
  await sendSms("RentCafe login: check your email for a verification code and reply with it here.");
  console.log("[auth] Waiting for OTP code via SMS...");

  // Wait for OTP to arrive via the pendingOtp mechanism
  const otp = await waitForOtp();
  if (!otp) {
    console.error("[auth] No OTP received within timeout");
    await sendSms("Login timed out — no verification code received. Please try again.");
    return false;
  }

  // Step 5: Fill OTP field
  const otpInput = await page.$(
    'input[name*="code" i], input[name*="otp" i], input[name*="verification" i], input[id*="code" i], input[type="tel"], input[type="number"]'
  );
  if (otpInput) {
    await otpInput.fill(otp);
  } else {
    // Try first visible input
    const visibleInputs = await page.$$("input:visible");
    if (visibleInputs.length > 0) {
      await visibleInputs[0].fill(otp);
    } else {
      console.error("[auth] Could not find OTP input field");
      return false;
    }
  }

  // Step 6: Submit OTP
  const otpSubmit = await page.$(
    'button[type="submit"], input[type="submit"], button:has-text("Verify"), button:has-text("Submit"), button:has-text("Continue"), button:has-text("Sign In")'
  );
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
    await sendSms("Successfully logged into RentCafe.");
    return true;
  }

  console.error("[auth] Login may have failed — check the browser");
  return false;
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
