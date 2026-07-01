import type { Page } from "playwright";
import { Solver } from "2captcha-ts";
import { config } from "./config.js";
import { saveCookies, isLoggedIn } from "./browser.js";
import { sendNotification } from "./notify.js";
import { isGmailConfigured, pollForOtp as gmailPollForOtp } from "./gmail.js";

const LOGIN_TIMEOUT = 5 * 60_000; // 5 minutes to wait for OTP

export async function login(page: Page): Promise<boolean> {
  console.log("[auth] Navigating to login page...");
  await page.goto(config.rentcafe.url, { waitUntil: "domcontentloaded", timeout: 60_000 });

  // Wait for Cloudflare to resolve (Browserbase handles this automatically)
  await page.waitForTimeout(20_000);

  // Check if we're already logged in (cookies were valid)
  if (await isLoggedIn(page)) {
    console.log("[auth] Already logged in via saved cookies");
    return true;
  }

  // Use 2captcha-based automated flow if configured
  if (config.captcha.apiKey && isGmailConfigured()) {
    console.log("[auth] Using automated captcha-solving + Gmail OTP flow...");
    return automatedCaptchaLogin(page);
  }

  // Fallback: manual flow (requires user to provide OTP via Telegram)
  return manualOtpLogin(page);
}

async function automatedCaptchaLogin(page: Page): Promise<boolean> {
  const solver = new Solver(config.captcha.apiKey);

  // Click "Continue with Email" if present
  const emailBtn = await page.$('button:has-text("Continue with Email")');
  if (emailBtn) {
    await emailBtn.click();
    await page.waitForTimeout(3000);
  }

  // Fill email
  console.log("[auth] Filling email...");
  const emailInput = await page.$('input#Email, input[type="email"], input[type="text"]');
  if (!emailInput) {
    console.error("[auth] Email input not found");
    return false;
  }
  await emailInput.click();
  await emailInput.type(config.rentcafe.email, { delay: 100 });
  await page.waitForTimeout(1000);

  // First submit — triggers Enterprise reCAPTCHA (expected to fail → v2 fallback)
  console.log("[auth] Submitting (Enterprise reCAPTCHA → v2 fallback)...");
  const submitBtn = (await page.$('#SendOTP')) ?? (await page.$('button:has-text("Send verification code")'));
  if (submitBtn) await submitBtn.click();
  await page.waitForTimeout(8000);

  // Solve v2 via 2captcha
  console.log("[auth] Solving reCAPTCHA v2 via 2captcha...");
  const v2Result = await solver.recaptcha({
    googlekey: config.captcha.standardSiteKey,
    pageurl: config.rentcafe.url,
  });
  const v2Token = v2Result.data;
  console.log(`[auth] v2 token received (${v2Token.length} chars)`);

  // Inject token + submit
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
      console.error("[auth] Server rejected captcha:", body.substring(0, 150));
      return false;
    }
    console.log("[auth] Server accepted captcha");
  }
  await page.waitForTimeout(3000);

  // Select email verification
  console.log("[auth] Selecting email verification...");
  const selected = await selectEmailVerification(page);
  if (!selected) {
    console.error("[auth] Could not select email verification method");
    return false;
  }

  // Click Continue to send OTP
  const cutoff = Math.floor(Date.now() / 1000);
  const contBtn = (await page.$('#sendOTPButton')) ?? (await page.$('button:has-text("Continue")'));
  if (contBtn) {
    await contBtn.click();
  } else {
    await page.evaluate(`sendOTP('sendOTPButton')`).catch(() => null);
  }
  console.log("[auth] OTP requested, polling Gmail...");
  await page.waitForTimeout(5000);

  // Poll Gmail for OTP
  const otp = await gmailPollForOtp(cutoff);
  if (!otp) {
    console.error("[auth] OTP not received from Gmail");
    await sendNotification("Login failed — OTP not received from Gmail within timeout.");
    return false;
  }
  console.log("[auth] OTP received from Gmail");

  // Enter OTP digits
  await page.waitForTimeout(2000);
  const entered = await enterOtpDigits(page, otp);
  if (!entered) {
    console.error("[auth] Could not enter OTP");
    return false;
  }

  // Click Verify
  const verifyBtn = (await page.$('#verifyOTPButton')) ?? (await page.$('button:has-text("Verify")'));
  if (verifyBtn) {
    await verifyBtn.click();
  } else {
    await page.keyboard.press("Enter");
  }

  await page.waitForTimeout(15_000);

  if (await isLoggedIn(page)) {
    console.log("[auth] Login successful!");
    await saveCookies();
    await sendNotification("Successfully logged into RentCafe.");
    return true;
  }

  const finalUrl = page.url();
  if (!finalUrl.includes("userlogin")) {
    console.log("[auth] Login successful (URL changed from login page).");
    await saveCookies();
    await sendNotification("Successfully logged into RentCafe.");
    return true;
  }

  console.error("[auth] Login verification failed");
  return false;
}

async function selectEmailVerification(page: Page): Promise<boolean> {
  const emailRadio = await page.$('input[type="radio"][value*="email"], input[type="radio"]:nth-of-type(2)');
  if (emailRadio) {
    await emailRadio.click();
    await page.waitForTimeout(500);
    return true;
  }

  const emailLabel = await page.$('label:has-text("gmail.com"), label:has-text("email")');
  if (emailLabel) {
    await emailLabel.click();
    await page.waitForTimeout(500);
    return true;
  }

  const radios = await page.$$('input[type="radio"]');
  if (radios.length >= 2) {
    await radios[1].click();
    await page.waitForTimeout(500);
    return true;
  }

  return false;
}

async function enterOtpDigits(page: Page, otp: string): Promise<boolean> {
  // RentCafe uses 6 individual single-digit input boxes
  const otpInputs = await page.$$('input[maxlength="1"], input.otp-input, input[type="tel"], input[type="number"]');

  if (otpInputs.length >= 6) {
    for (let i = 0; i < 6 && i < otp.length; i++) {
      await otpInputs[i].click();
      await otpInputs[i].fill(otp[i]);
      await page.waitForTimeout(100);
    }
    console.log("[auth] OTP digits entered");
    return true;
  }

  // Fallback: type full code via keyboard
  const firstInput = await page.$('input:not([type="hidden"]):not(#Email):visible');
  if (firstInput) {
    await firstInput.click();
    await page.keyboard.type(otp, { delay: 100 });
    return true;
  }

  return false;
}

async function manualOtpLogin(page: Page): Promise<boolean> {
  // Click "Continue with Email"
  const emailBtn = await page.$(
    'button:has-text("Continue with Email"), a:has-text("Continue with Email")'
  );
  if (emailBtn) {
    await emailBtn.click();
    await page.waitForTimeout(3000);
  }

  // Fill email
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

  // Submit
  const submitBtn =
    (await page.$('button[type="submit"]:visible')) ??
    (await page.$('button:has-text("Send Code"):visible')) ??
    (await page.$('button:has-text("Continue"):visible')) ??
    (await page.$('button:has-text("Sign In"):visible')) ??
    (await page.$('button:has-text("Log In"):visible'));
  if (submitBtn) {
    await submitBtn.click();
  } else {
    await page.keyboard.press("Enter");
  }

  // Request OTP via notification
  const manualOtpPromise = waitForOtp();
  const otpCutoff = Math.floor(Date.now() / 1000);
  await page.waitForTimeout(3000);

  let otp: string | null = null;

  if (isGmailConfigured()) {
    console.log("[auth] Gmail configured — auto-reading OTP...");
    await sendNotification("RentCafe login triggered — reading OTP from Gmail...");
    otp = await gmailPollForOtp(otpCutoff);
  }

  if (!otp) {
    await sendNotification("RentCafe login: check your email for a verification code and reply here.");
    console.log("[auth] Waiting for OTP via message...");
    otp = await manualOtpPromise;
  }

  if (!otp) {
    console.error("[auth] No OTP received");
    await sendNotification("Login timed out — no code received.");
    return false;
  }

  console.log("[auth] OTP received, entering code...");

  // Fill OTP
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
    const visibleInputs = await page.$$("input:visible");
    const nonEmail = await findNonEmailInput(visibleInputs);
    if (nonEmail) {
      await nonEmail.fill(otp);
    } else {
      console.error("[auth] Could not find OTP input");
      return false;
    }
  }

  // Submit OTP
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

  await page.waitForTimeout(5000);

  if (await isLoggedIn(page)) {
    console.log("[auth] Login successful!");
    await saveCookies();
    await sendNotification("Successfully logged into RentCafe.");
    return true;
  }

  console.error("[auth] Login may have failed");
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

// --- OTP exchange mechanism (for manual/Telegram flow) ---

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
