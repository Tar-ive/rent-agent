/**
 * Generic maintenance request submission via Browserbase + 2captcha + Gmail OTP.
 * Used by the Telegram bot for on-demand work orders.
 */

import Browserbase from "@browserbasehq/sdk";
import { chromium } from "playwright";
import { Solver } from "2captcha-ts";
import { google } from "googleapis";
import { config } from "./config.js";

export async function submitMaintenanceRequest(description: string): Promise<{
  success: boolean;
  requestId?: string;
  error?: string;
  screenshot?: Buffer;
}> {
  console.log(`[maintenance] Starting submission: "${description.substring(0, 50)}..."`);

  const bb = new Browserbase({ apiKey: config.browserbase.apiKey });
  const session = await bb.sessions.create({
    projectId: config.browserbase.projectId,
    browserSettings: { solveCaptchas: true },
  });
  console.log(`[maintenance] Session: ${session.id}`);

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
    console.log("[maintenance] Navigating to maintenance...");
    const noThanks = await page.$('button:has-text("No Thanks"), a:has-text("No Thanks")');
    if (noThanks) { await noThanks.click(); await page.waitForTimeout(1000); }

    const goToMaint = await page.$('a:has-text("Go to Maintenance")');
    if (goToMaint) {
      await goToMaint.click();
      await page.waitForTimeout(5000);
    } else {
      const sidebarLink = await page.$('a:has-text("Maintenance Request"), a:has-text("Maintenance")');
      if (sidebarLink) { await sidebarLink.click(); await page.waitForTimeout(5000); }
    }

    // === NEW REQUEST ===
    const newBtn = await page.$('button:has-text("NEW REQUEST"), a:has-text("NEW REQUEST"), button:has-text("New Request")');
    if (newBtn) { await newBtn.click(); await page.waitForTimeout(3000); }

    // === FILL FORM ===
    console.log("[maintenance] Filling form...");

    // Priority
    await page.selectOption("#ddlPriority", { label: "Low" }).catch(() => null);
    await page.waitForTimeout(500);

    // Category - try to match from description
    const categoryOpts = await page.$$("#ddlCategory option");
    let categorySet = false;
    const descLower = description.toLowerCase();
    const categoryMap: Record<string, string[]> = {
      plumb: ["plumb", "water", "faucet", "drain", "toilet", "leak", "pipe", "bathtub", "shower"],
      electric: ["electric", "socket", "outlet", "light", "switch", "power"],
      hvac: ["hvac", "ac", "air", "heat", "cool", "thermostat"],
      pest: ["pest", "bug", "roach", "ant", "mouse", "rat"],
      appliance: ["appliance", "dishwasher", "washer", "dryer", "fridge", "oven", "stove"],
    };

    for (const opt of categoryOpts) {
      const optText = ((await opt.textContent()) ?? "").toLowerCase();
      const value = (await opt.getAttribute("value")) ?? "";
      if (!value) continue;

      for (const [catKey, keywords] of Object.entries(categoryMap)) {
        if (optText.includes(catKey) && keywords.some((k) => descLower.includes(k))) {
          await page.selectOption("#ddlCategory", value);
          categorySet = true;
          break;
        }
      }
      if (categorySet) break;
    }

    // Fallback: select "Other" or first valid option
    if (!categorySet) {
      for (const opt of categoryOpts) {
        const optText = ((await opt.textContent()) ?? "").toLowerCase();
        const value = (await opt.getAttribute("value")) ?? "";
        if (value && (optText.includes("other") || optText.includes("general"))) {
          await page.selectOption("#ddlCategory", value);
          categorySet = true;
          break;
        }
      }
      if (!categorySet) {
        for (const opt of categoryOpts) {
          const value = (await opt.getAttribute("value")) ?? "";
          const optText = ((await opt.textContent()) ?? "").toLowerCase();
          if (value && !optText.includes("select") && optText !== "category") {
            await page.selectOption("#ddlCategory", value);
            break;
          }
        }
      }
    }
    await page.waitForTimeout(3000);

    // Subcategory - first available
    const subOpts = await page.$$("#ddlSubcategory option");
    for (const opt of subOpts) {
      const value = (await opt.getAttribute("value")) ?? "";
      const text = ((await opt.textContent()) ?? "").toLowerCase();
      if (value && !text.includes("select")) {
        await page.selectOption("#ddlSubcategory", value);
        break;
      }
    }
    await page.waitForTimeout(500);

    // Location - try to match from description
    const locOpts = await page.$$("#Location option");
    let locationSet = false;
    const locationMap: Record<string, string[]> = {
      bath: ["bath", "tub", "shower"],
      kitchen: ["kitchen", "cook", "fridge", "stove", "oven"],
      bedroom: ["bed", "room"],
      living: ["living", "lounge", "common"],
    };

    for (const opt of locOpts) {
      const optText = ((await opt.textContent()) ?? "").toLowerCase();
      const value = (await opt.getAttribute("value")) ?? "";
      if (!value) continue;

      for (const [locKey, keywords] of Object.entries(locationMap)) {
        if (optText.includes(locKey) && keywords.some((k) => descLower.includes(k))) {
          await page.selectOption("#Location", value);
          locationSet = true;
          break;
        }
      }
      if (locationSet) break;
    }

    if (!locationSet) {
      for (const opt of locOpts) {
        const value = (await opt.getAttribute("value")) ?? "";
        const optText = ((await opt.textContent()) ?? "").toLowerCase();
        if (value && !optText.includes("select")) {
          await page.selectOption("#Location", value);
          break;
        }
      }
    }
    await page.waitForTimeout(500);

    // Description
    const textarea = await page.$("textarea");
    if (textarea) await textarea.fill(description);
    await page.waitForTimeout(500);

    // Permission + Pet
    await page.selectOption("#ddlPermissionToEnter", { label: "Yes" }).catch(() => null);
    await page.waitForTimeout(300);
    await page.selectOption("#ddlHasPet", { label: "No" }).catch(() => null);
    await page.waitForTimeout(300);

    // === SUBMIT ===
    console.log("[maintenance] Submitting...");
    const submitBtn = await page.$('button:has-text("SUBMIT REQUEST"), button:has-text("Submit Request"), button:has-text("SUBMIT")');
    if (submitBtn) { await submitBtn.click(); await page.waitForTimeout(10000); }

    const bodyText = (await page.textContent("body")) ?? "";
    if (bodyText.includes("successfully created") || bodyText.includes("submitted")) {
      const idMatch = bodyText.match(/\b(5\d{5})\b/);
      const requestId = idMatch?.[1];
      console.log(`[maintenance] SUCCESS${requestId ? ` (ID: ${requestId})` : ""}`);
      const screenshot = await page.screenshot().catch((err: unknown) => {
        console.error("[maintenance] Screenshot failed:", err);
        return undefined;
      });
      return { success: true, requestId, screenshot };
    }

    return { success: false, error: "Submission result unclear — form may not have submitted" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[maintenance] Error:", msg);
    return { success: false, error: msg };
  } finally {
    await browser.close();
  }
}

async function loginFlow(page: any): Promise<boolean> {
  const solver = new Solver(config.captcha.apiKey);

  // Navigate
  await page.goto(config.rentcafe.url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(20000);

  const title = await page.title();
  if (!title.includes("Account Access") && !title.includes("Resident")) {
    console.error("[maintenance] Page didn't load correctly:", title);
    return false;
  }

  // Continue with Email
  const emailBtn = await page.$('button:has-text("Continue with Email")');
  if (emailBtn) { await emailBtn.click(); await page.waitForTimeout(3000); }

  // Fill email
  const emailInput = await page.$('input#Email, input[type="email"], input[type="text"]');
  if (!emailInput) { console.error("[maintenance] Email input not found"); return false; }
  await emailInput.fill(config.rentcafe.email);
  await page.waitForTimeout(1000);

  // Click submit
  const sendBtn = await page.$('#SendOTP, button:has-text("Send verification code")');
  if (sendBtn) await sendBtn.click();
  await page.waitForTimeout(8000);

  // Solve reCAPTCHA
  console.log("[maintenance] Solving reCAPTCHA...");
  const v2Result = await solver.recaptcha({
    googlekey: config.captcha.standardSiteKey,
    pageurl: config.rentcafe.url,
  });
  const v2Token = v2Result.data;

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
    })();
  `);

  const respPromise = page.waitForResponse(
    (resp: any) => resp.url().includes("handler=LoginUsername"),
    { timeout: 30000 }
  ).catch(() => null);

  await page.evaluate(`LoginUserFormAction('OTP')`).catch(() => null);

  const resp = await respPromise;
  if (resp) {
    const body = await resp.text().catch(() => "");
    if (!body.includes('"success":true')) {
      console.error("[maintenance] Server rejected captcha");
      return false;
    }
  }
  await page.waitForTimeout(3000);

  // Select email verification
  await page.evaluate(`
    (function() {
      var radios = document.querySelectorAll('input[type="radio"]');
      for (var i = 0; i < radios.length; i++) {
        var label = document.querySelector('label[for="' + radios[i].id + '"]');
        if (label && (label.textContent.includes('email') || label.textContent.includes('@'))) {
          radios[i].checked = true; radios[i].click(); break;
        }
      }
    })();
  `);
  await page.waitForTimeout(500);

  // Send OTP
  const cutoff = Math.floor(Date.now() / 1000);
  const contBtn = await page.$("#sendOTPButton");
  if (contBtn) await contBtn.click();
  else await page.evaluate(`typeof sendOTP === 'function' && sendOTP('sendOTPButton')`).catch(() => null);
  await page.waitForTimeout(5000);

  // Poll Gmail
  const otp = await pollGmailOtp(cutoff);
  if (!otp) { console.error("[maintenance] OTP not received"); return false; }
  console.log(`[maintenance] OTP: ${otp}`);

  // Enter OTP
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

  return !page.url().includes("userlogin");
}

async function pollGmailOtp(cutoffEpoch: number): Promise<string | null> {
  const oauth2 = new google.auth.OAuth2(config.gmail.clientId, config.gmail.clientSecret);
  oauth2.setCredentials({ refresh_token: config.gmail.refreshToken });
  const gmail = google.gmail({ version: "v1", auth: oauth2 });

  for (let i = 0; i < 24; i++) {
    console.log(`[maintenance] OTP poll ${i + 1}/24...`);
    try {
      const res = await gmail.users.messages.list({
        userId: "me",
        q: `from:${config.gmail.otpSender} subject:OTP newer_than:1h`,
        maxResults: 5,
      });
      for (const msg of res.data.messages ?? []) {
        const full = await gmail.users.messages.get({ userId: "me", id: msg.id!, format: "full" });
        const ts = Number(full.data.internalDate ?? "0") / 1000;
        if (ts < cutoffEpoch) continue;
        const parts = full.data.payload?.parts ?? [];
        let body = "";
        if (parts.length > 0) {
          for (const p of parts) { if (p.body?.data) body += Buffer.from(p.body.data, "base64url").toString(); }
        } else if (full.data.payload?.body?.data) {
          body = Buffer.from(full.data.payload.body.data, "base64url").toString();
        }
        const text = body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
        const m = text.match(/(\d{6})\s*is your (?:one-time|OTP)/i) ?? text.match(/(?:OTP|code|password)[^\d]{0,30}(\d{6})/i);
        if (m) return m[1];
      }
    } catch (err) { console.error("[maintenance] Gmail error:", err); }
    await new Promise((r) => setTimeout(r, 5000));
  }
  return null;
}
