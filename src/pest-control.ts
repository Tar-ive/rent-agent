/**
 * Automated weekly pest control request submission.
 *
 * Creates a fresh Browserbase session, logs in via 2captcha + Gmail OTP,
 * navigates to the maintenance form, and submits a pest control request.
 *
 * Used by the scheduler (node-cron) and can be run manually:
 *   npm run pest-control
 */

import Browserbase from "@browserbasehq/sdk";
import { chromium } from "playwright";
import { Solver } from "2captcha-ts";
import { google } from "googleapis";
import { config } from "./config.js";
import { sendNotification } from "./notify.js";

const PEST_CONTROL_DESCRIPTION =
  "Requesting scheduled pest control treatment for the apartment. Please treat all rooms including kitchen, bathrooms, and common areas.";

export async function submitPestControl(): Promise<{
  success: boolean;
  requestId?: string;
  error?: string;
}> {
  console.log("[pest-control] Starting pest control submission...");

  const bb = new Browserbase({ apiKey: config.browserbase.apiKey });
  const session = await bb.sessions.create({
    projectId: config.browserbase.projectId,
    browserSettings: { solveCaptchas: true },
  });
  console.log(`[pest-control] Session: ${session.id}`);

  const browser = await chromium.connectOverCDP(session.connectUrl);
  const context = browser.contexts()[0];
  const page = context.pages()[0];

  try {
    // === LOGIN ===
    const loggedIn = await loginFlow(page);
    if (!loggedIn) {
      return { success: false, error: "Login failed" };
    }

    // === NAVIGATE TO MAINTENANCE ===
    console.log("[pest-control] Navigating to maintenance...");

    // Dismiss notification popup if visible
    const noThanks = await page.$('button:has-text("No Thanks"), a:has-text("No Thanks")');
    if (noThanks) {
      await noThanks.click();
      await page.waitForTimeout(1000);
    }

    const goToMaint = await page.$('a:has-text("Go to Maintenance")');
    if (goToMaint) {
      await goToMaint.click();
      await page.waitForTimeout(5000);
    } else {
      const sidebarLink = await page.$('a:has-text("Maintenance Request")');
      if (sidebarLink) {
        await sidebarLink.click();
        await page.waitForTimeout(5000);
      }
    }

    // Click NEW REQUEST
    const newReqBtn = await page.$(
      'button:has-text("NEW REQUEST"), a:has-text("NEW REQUEST"), button:has-text("New Request"), a:has-text("New Request")'
    );
    if (newReqBtn) {
      await newReqBtn.click();
      await page.waitForTimeout(3000);
    }

    // === FILL FORM ===
    console.log("[pest-control] Filling form...");

    // Priority - Low
    await page.selectOption("#ddlPriority", { label: "Low" }).catch(() => null);
    await page.waitForTimeout(500);

    // Category - find "Pest" option
    const categoryOpts = await page.$$("#ddlCategory option");
    let categorySet = false;
    for (const opt of categoryOpts) {
      const text = (await opt.textContent() ?? "").toLowerCase();
      if (text.includes("pest")) {
        const value = await opt.getAttribute("value") ?? "";
        if (value) {
          await page.selectOption("#ddlCategory", value);
          categorySet = true;
          break;
        }
      }
    }
    if (!categorySet) {
      // Fallback: select "General" or first valid option
      for (const opt of categoryOpts) {
        const text = (await opt.textContent() ?? "").toLowerCase();
        const value = await opt.getAttribute("value") ?? "";
        if (value && !text.includes("select") && text !== "category *") {
          await page.selectOption("#ddlCategory", value);
          break;
        }
      }
    }
    await page.waitForTimeout(2000);

    // Subcategory if available
    const subOpts = await page.$$("#ddlSubcategory option");
    for (const opt of subOpts) {
      const text = (await opt.textContent() ?? "").toLowerCase();
      const value = await opt.getAttribute("value") ?? "";
      if (value && !text.includes("select") && text !== "subcategory") {
        await page.selectOption("#ddlSubcategory", value);
        break;
      }
    }
    await page.waitForTimeout(500);

    // Location - select first available
    const locOpts = await page.$$("#Location option");
    for (const opt of locOpts) {
      const value = await opt.getAttribute("value") ?? "";
      const text = (await opt.textContent() ?? "").toLowerCase();
      if (value && !text.includes("select") && text !== "location") {
        await page.selectOption("#Location", value);
        break;
      }
    }
    await page.waitForTimeout(500);

    // Description
    const textarea = await page.$("textarea");
    if (textarea) {
      await textarea.fill(PEST_CONTROL_DESCRIPTION);
    }
    await page.waitForTimeout(500);

    // Permission to enter - Yes
    await page.selectOption("#ddlPermissionToEnter", { label: "Yes" }).catch(() => null);
    await page.waitForTimeout(500);

    // Pet - No
    await page.selectOption("#ddlHasPet", { label: "No" }).catch(() => null);
    await page.waitForTimeout(500);

    // === SUBMIT ===
    console.log("[pest-control] Submitting...");
    const submitBtn = await page.$(
      'button:has-text("SUBMIT REQUEST"), button:has-text("Submit Request"), button:has-text("SUBMIT")'
    );
    if (submitBtn) {
      await submitBtn.click();
      await page.waitForTimeout(10000);
    }

    // Check for success
    const bodyText = await page.textContent("body") ?? "";
    if (bodyText.includes("successfully created") || bodyText.includes("submitted")) {
      const idMatch = bodyText.match(/\b(5\d{5})\b/);
      const requestId = idMatch?.[1];
      console.log(`[pest-control] Success! Request ID: ${requestId ?? "unknown"}`);
      return { success: true, requestId: requestId ?? undefined };
    }

    // Check for validation errors
    const errors = await page.$$eval(
      ".text-danger, .error-message, [class*='error']",
      (els) => els.map((e) => e.textContent?.trim()).filter(Boolean)
    );
    if (errors.length > 0) {
      console.error("[pest-control] Validation errors:", errors);
      return { success: false, error: `Validation: ${errors.join("; ")}` };
    }

    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[pest-control] Error:", msg);
    return { success: false, error: msg };
  } finally {
    await browser.close();
  }
}

async function loginFlow(page: import("playwright").Page): Promise<boolean> {
  const solver = new Solver(config.captcha.apiKey);

  // Navigate to RentCafe
  console.log("[pest-control] Navigating to RentCafe...");
  await page.goto(config.rentcafe.url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(20000);

  // Check if already logged in
  const url = page.url();
  if (!url.includes("userlogin")) {
    console.log("[pest-control] Already logged in");
    return true;
  }

  // Fill email
  const emailBtn = await page.$('button:has-text("Continue with Email")');
  if (emailBtn) {
    await emailBtn.click();
    await page.waitForTimeout(3000);
  }

  const emailInput = await page.$('input#Email, input[type="email"], input[type="text"]');
  if (!emailInput) return false;
  await emailInput.fill(config.rentcafe.email);
  await page.waitForTimeout(1000);

  // Trigger reCAPTCHA
  const submitBtn = await page.$('button:has-text("Send verification code"), #SendOTP');
  if (submitBtn) await submitBtn.click();
  await page.waitForTimeout(8000);

  // Solve v2 via 2captcha
  console.log("[pest-control] Solving reCAPTCHA...");
  let v2Token: string;
  try {
    const result = await solver.recaptcha({
      googlekey: config.captcha.standardSiteKey,
      pageurl: config.rentcafe.url,
    });
    v2Token = result.data;
  } catch (err) {
    console.error("[pest-control] 2captcha failed:", err);
    return false;
  }

  // Inject token
  const v2Safe = JSON.stringify(v2Token);
  await page.evaluate(`
    (function() {
      var token = ${v2Safe};
      document.querySelectorAll('[id*="g-recaptcha-response"], textarea[name="g-recaptcha-response"]').forEach(function(el) {
        el.value = token; el.innerHTML = token;
      });
      var ta = document.getElementById('g-recaptcha-response');
      if (ta) { ta.value = token; ta.innerHTML = token; }
      var fce = document.querySelector('input[name="failedcaptchaent"]');
      if (fce) fce.value = 'true';
      if (window.grecaptcha) { window.grecaptcha.getResponse = function() { return token; }; }
      var rb = document.getElementById('recaptcha-block');
      if (rb) rb.classList.remove('d-none');
    })();
  `);
  await page.waitForTimeout(1000);

  // Submit via LoginUserFormAction
  const respPromise = page.waitForResponse(
    (resp) => resp.url().includes("handler=LoginUsername"),
    { timeout: 30000 }
  ).catch(() => null);

  await page.evaluate(`LoginUserFormAction('OTP')`).catch(async () => {
    const sendBtn = await page.$('button:has-text("Send verification code")');
    if (sendBtn) await sendBtn.click({ force: true });
  });

  const resp = await respPromise;
  if (resp) {
    const body = await resp.text().catch(() => "");
    if (!body.includes('"success":true')) {
      console.error("[pest-control] Server rejected captcha:", body.substring(0, 150));
      return false;
    }
    console.log("[pest-control] Server accepted captcha");
  }
  await page.waitForTimeout(3000);

  // Select email verification
  await page.evaluate(`
    (function() {
      var radio = document.querySelector('input[type="radio"][value*="email"]') ||
                  document.querySelector('input[type="radio"][value*="Email"]');
      if (radio) { radio.checked = true; radio.click(); }
    })();
  `);
  await page.waitForTimeout(500);

  // Click Continue / send OTP
  const cutoff = Math.floor(Date.now() / 1000);
  const contBtn = await page.$("#sendOTPButton");
  if (contBtn) {
    await contBtn.click();
  } else {
    await page.evaluate(`
      (function() {
        if (typeof sendOTP === 'function') sendOTP('sendOTPButton');
      })();
    `).catch(() => null);
  }
  await page.waitForTimeout(5000);

  // Poll Gmail for OTP
  console.log("[pest-control] Polling Gmail for OTP...");
  const otp = await pollGmailOtp(cutoff);
  if (!otp) {
    console.error("[pest-control] OTP not received");
    return false;
  }

  // Enter OTP digits
  const otpInputs = await page.$$('input[maxlength="1"], input.otp-input');
  if (otpInputs.length >= 6) {
    for (let i = 0; i < 6; i++) {
      await otpInputs[i].click();
      await otpInputs[i].fill(otp[i]);
      await page.waitForTimeout(100);
    }
  }
  await page.waitForTimeout(1000);

  // Verify
  const verifyBtn = (await page.$("#verifyOTPButton")) ?? (await page.$('button:has-text("Verify")'));
  if (verifyBtn) await verifyBtn.click();
  else await page.keyboard.press("Enter");

  await page.waitForTimeout(15000);

  const finalUrl = page.url();
  return !finalUrl.includes("userlogin");
}

async function pollGmailOtp(cutoffEpoch: number): Promise<string | null> {
  const oauth2 = new google.auth.OAuth2(config.gmail.clientId, config.gmail.clientSecret);
  oauth2.setCredentials({ refresh_token: config.gmail.refreshToken });
  const gmail = google.gmail({ version: "v1", auth: oauth2 });

  for (let i = 0; i < 24; i++) {
    console.log(`[pest-control] OTP poll ${i + 1}/24...`);
    try {
      const res = await gmail.users.messages.list({
        userId: "me",
        q: `from:${config.gmail.otpSender} subject:OTP newer_than:1h`,
        maxResults: 5,
      });

      for (const msg of res.data.messages ?? []) {
        const full = await gmail.users.messages.get({ userId: "me", id: msg.id!, format: "full" });
        const internalDate = Number(full.data.internalDate ?? "0") / 1000;
        if (internalDate < cutoffEpoch) continue;

        const parts = full.data.payload?.parts ?? [];
        let body = "";
        if (parts.length > 0) {
          for (const part of parts) {
            if (part.body?.data) body += Buffer.from(part.body.data, "base64url").toString();
          }
        } else if (full.data.payload?.body?.data) {
          body = Buffer.from(full.data.payload.body.data, "base64url").toString();
        }

        const text = body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
        const match = text.match(/(\d{6})\s*is your (?:one-time|OTP)/i);
        if (match) return match[1];
        const match2 = text.match(/(?:OTP|code|password)[^\d]{0,30}(\d{6})/i);
        if (match2) return match2[1];
      }
    } catch (err) {
      console.error("[pest-control] Gmail error:", err);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  return null;
}

// CLI entry point
if (process.argv[1]?.includes("pest-control")) {
  submitPestControl()
    .then(async (result) => {
      if (result.success) {
        const msg = `Pest control request submitted${result.requestId ? ` (ID: ${result.requestId})` : ""}`;
        console.log(`[pest-control] ${msg}`);
        await sendNotification(msg);
      } else {
        console.error(`[pest-control] Failed: ${result.error}`);
        await sendNotification(`Pest control submission failed: ${result.error}`);
      }
      process.exit(result.success ? 0 : 1);
    })
    .catch((err) => {
      console.error("Fatal:", err);
      process.exit(1);
    });
}
