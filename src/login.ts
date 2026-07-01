/**
 * Automated login — solves reCAPTCHA via 2captcha and reads OTP from Gmail.
 *
 * Usage:  npm run login
 *
 * Flow:
 * 1. Navigate to RentCafe (Browserbase handles Cloudflare)
 * 2. Fill email → submit → reCAPTCHA Enterprise fails → v2 fallback shown
 * 3. Solve v2 via 2captcha API → inject token → submit with OTP action
 * 4. Select email verification → Continue
 * 5. Poll Gmail for OTP → enter 6 digits → verify
 * 6. Dashboard loaded — logged in!
 */

import type { Page } from "playwright";
import { Solver } from "2captcha-ts";
import { launchBrowser, getPage, closeBrowser, isLoggedIn, getContextId } from "./browser.js";
import { config } from "./config.js";
import { pollForOtp, isGmailConfigured } from "./gmail.js";

export async function automatedLogin(): Promise<boolean> {
  console.log("[login] Starting automated login...");

  if (!config.captcha.apiKey) {
    console.error("[login] CAPTCHA_API_KEY not set — cannot solve reCAPTCHA");
    return false;
  }

  if (!isGmailConfigured()) {
    console.error("[login] Gmail not configured — cannot poll for OTP");
    return false;
  }

  try {
    const solver = new Solver(config.captcha.apiKey);
    await launchBrowser();
    const page = await getPage();
    // Step 1: Navigate + Cloudflare bypass
    console.log("[login] Navigating to RentCafe...");
    await page.goto(config.rentcafe.url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(20_000);

    if (await isLoggedIn(page)) {
      console.log("[login] Already logged in!");
      return true;
    }

    // Step 2: Click "Continue with Email" if present
    const emailBtn = await page.$('button:has-text("Continue with Email")');
    if (emailBtn) {
      await emailBtn.click();
      await page.waitForTimeout(3000);
    }

    // Step 3: Fill email
    console.log("[login] Filling email...");
    const emailInput = await page.$('input#Email, input[type="email"], input[type="text"]');
    if (!emailInput) {
      console.error("[login] Email input not found");
      return false;
    }
    await emailInput.click();
    await emailInput.fill(config.rentcafe.email);
    await page.waitForTimeout(1000);

    // Step 4: First submit — triggers Enterprise reCAPTCHA (expected to fail)
    console.log("[login] Submitting (Enterprise reCAPTCHA will fail, triggering v2 fallback)...");
    const submitBtn = (await page.$('#SendOTP')) ?? (await page.$('button:has-text("Send verification code")'));
    if (submitBtn) await submitBtn.click();
    await page.waitForTimeout(8000);

    // Step 5: Solve v2 via 2captcha
    console.log("[login] Solving reCAPTCHA v2 via 2captcha...");
    let v2Token: string;
    try {
      const v2Result = await solver.recaptcha({
        googlekey: config.captcha.standardSiteKey,
        pageurl: config.rentcafe.url,
      });
      v2Token = v2Result.data;
    } catch (solverErr) {
      console.error("[login] 2captcha solver failed:", solverErr);
      return false;
    }
    console.log(`[login] v2 token received (${v2Token.length} chars)`);

    // Step 6: Inject v2 token + set failedcaptchaent + submit OTP action
    const v2Safe = JSON.stringify(v2Token);
    await page.evaluate(`
      (function() {
        var token = ${v2Safe};
        var ta = document.getElementById('g-recaptcha-response');
        if (ta) { ta.value = token; ta.innerHTML = token; }
        var rcDiv = document.getElementById('recaptcha');
        if (rcDiv) { var ta2 = rcDiv.querySelector('textarea'); if (ta2) { ta2.value = token; ta2.innerHTML = token; } }
        var fce = document.querySelector('input[name="failedcaptchaent"]');
        if (fce) fce.value = 'true';
        if (window.grecaptcha) { window.grecaptcha.getResponse = function() { return token; }; }
        var rb = document.getElementById('recaptcha-block');
        if (rb) rb.classList.remove('d-none');
      })();
    `);

    const respPromise = page.waitForResponse(
      (resp) => resp.url().includes("handler=LoginUsername"),
      { timeout: 30000 }
    ).catch(() => null);

    await page.evaluate(`LoginUserFormAction('OTP')`);

    const resp = await respPromise;
    if (resp) {
      const body = await resp.text().catch(() => "");
      if (!body.includes('"success":true')) {
        console.error("[login] Server rejected captcha:", body.substring(0, 150));
        return false;
      }
      console.log("[login] Server accepted captcha");
    }
    await page.waitForTimeout(3000);

    // Step 7: Select email verification (second radio button)
    console.log("[login] Selecting email verification...");
    const selected = await selectEmailVerification(page);
    if (!selected) {
      console.error("[login] Could not select email verification method");
      return false;
    }

    // Step 8: Click Continue to send OTP
    const cutoff = Math.floor(Date.now() / 1000);
    const contBtn = (await page.$('#sendOTPButton')) ?? (await page.$('button:has-text("Continue")'));
    if (contBtn) {
      await contBtn.click();
    } else {
      await page.evaluate(`sendOTP('sendOTPButton')`).catch(() => null);
    }
    console.log("[login] OTP requested, polling Gmail...");
    await page.waitForTimeout(5000);

    // Step 9: Poll Gmail for OTP
    const otp = await pollForOtp(cutoff);
    if (!otp) {
      console.error("[login] OTP not received from Gmail within timeout");
      return false;
    }
    console.log("[login] OTP received from Gmail");

    // Step 10: Enter OTP digits
    await page.waitForTimeout(2000);
    const entered = await enterOtp(page, otp);
    if (!entered) {
      console.error("[login] Could not enter OTP");
      return false;
    }

    // Step 11: Click Verify
    console.log("[login] Verifying OTP...");
    const verifyBtn = (await page.$('#verifyOTPButton')) ?? (await page.$('button:has-text("Verify")'));
    if (verifyBtn) {
      await verifyBtn.click();
    } else {
      await page.keyboard.press("Enter");
    }

    await page.waitForTimeout(15_000);

    if (await isLoggedIn(page)) {
      console.log("[login] Login successful! Dashboard loaded.");
      return true;
    }

    const finalUrl = page.url();
    if (!finalUrl.includes("userlogin")) {
      console.log("[login] Login successful (URL changed from login page).");
      return true;
    }

    console.error("[login] Login verification failed — still on login page");
    return false;
  } catch (err) {
    console.error("[login] Error:", err);
    return false;
  }
}

async function selectEmailVerification(page: Page): Promise<boolean> {
  // Try value-based selector first
  const emailRadio = await page.$('input[type="radio"][value*="email" i]');
  if (emailRadio) {
    await emailRadio.click();
    await page.waitForTimeout(500);
    return true;
  }

  // Try label containing "gmail" or "email"
  const emailLabel = await page.$('label:has-text("gmail.com"), label:has-text("email")');
  if (emailLabel) {
    await emailLabel.click();
    await page.waitForTimeout(500);
    return true;
  }

  // Try radio whose adjacent label mentions email
  const radios = await page.$$('input[type="radio"]');
  for (const radio of radios) {
    const id = await radio.getAttribute("id");
    if (id) {
      const label = await page.$(`label[for="${id}"]`);
      const text = await label?.textContent() ?? "";
      if (text.toLowerCase().includes("email") || text.includes("@")) {
        await radio.click();
        await page.waitForTimeout(500);
        return true;
      }
    }
  }

  return false;
}

async function enterOtp(page: Page, otp: string): Promise<boolean> {
  // Validate OTP is exactly 6 digits
  if (!/^\d{6}$/.test(otp)) {
    console.error(`[login] Invalid OTP format: expected 6 digits, got "${otp}"`);
    return false;
  }

  // RentCafe uses 6 individual single-digit input boxes
  const otpInputs = await page.$$('input[maxlength="1"], input.otp-input, input[type="tel"], input[type="number"]');

  if (otpInputs.length >= 6) {
    for (let i = 0; i < 6; i++) {
      await otpInputs[i].click();
      await otpInputs[i].fill(otp[i]);
      await page.waitForTimeout(100);
    }
    console.log("[login] OTP digits entered");
    return true;
  }

  // Fallback: find first visible non-email input and type full code
  const firstInput = await page.$('input:not([type="hidden"]):not(#Email):visible');
  if (firstInput) {
    await firstInput.click();
    await page.keyboard.type(otp, { delay: 100 });
    console.log("[login] OTP typed via keyboard");
    return true;
  }

  return false;
}

// CLI entry point
if (process.argv[1]?.includes("login")) {
  automatedLogin()
    .then(async (success) => {
      if (success) {
        const ctxId = getContextId();
        if (ctxId) {
          console.log(`\nContext ID: ${ctxId}`);
          console.log("(Save as BROWSERBASE_CONTEXT_ID in .env for cookie persistence)\n");
        }
        console.log("You can now start the agent with: npm start");
      } else {
        console.error("Login failed.");
      }
      await closeBrowser();
      process.exit(success ? 0 : 1);
    })
    .catch((err) => {
      console.error("Fatal:", err);
      process.exit(1);
    });
}
