/**
 * Browser Workflow Recorder
 *
 * Opens a Browserbase session with a live debug URL, injects event listeners
 * into the page, and captures user interactions as a replayable workflow JSON.
 *
 * Approach inspired by OpenFang's Browser Hand + Playwright Codegen:
 * - Inject recording script via page.addInitScript()
 * - Capture clicks, inputs, selects, navigations
 * - Generate multiple selector strategies per element (id, data-*, aria, text, CSS path)
 * - Output a portable JSON workflow file
 *
 * Usage: npm run record -- --name "maintenance-request"
 */

import Browserbase from "@browserbasehq/sdk";
import { chromium, type Page, type BrowserContext } from "playwright";
import { config } from "../config.js";
import type { Workflow, WorkflowStep } from "./types.js";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const RECORDING_SCRIPT = `
(function() {
  if (window.__workflowRecorderInstalled) return;
  window.__workflowRecorderInstalled = true;
  window.__recordedSteps = [];

  function generateSelectors(el) {
    const selectors = [];

    // 1. ID (most specific)
    if (el.id) {
      selectors.push('#' + CSS.escape(el.id));
    }

    // 2. data-testid, data-cy, data-qa
    for (const attr of ['data-testid', 'data-cy', 'data-qa', 'data-id']) {
      if (el.getAttribute(attr)) {
        selectors.push('[' + attr + '="' + el.getAttribute(attr) + '"]');
      }
    }

    // 3. aria-label
    if (el.getAttribute('aria-label')) {
      selectors.push('[aria-label="' + el.getAttribute('aria-label') + '"]');
    }

    // 4. name attribute (for inputs)
    if (el.name && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) {
      selectors.push(el.tagName.toLowerCase() + '[name="' + el.name + '"]');
    }

    // 5. type + placeholder (for inputs)
    if (el.tagName === 'INPUT' && el.type && el.placeholder) {
      selectors.push('input[type="' + el.type + '"][placeholder="' + el.placeholder + '"]');
    }

    // 6. Text content (for buttons/links)
    if ((el.tagName === 'BUTTON' || el.tagName === 'A') && el.textContent.trim()) {
      const text = el.textContent.trim().substring(0, 50);
      selectors.push(el.tagName.toLowerCase() + ':has-text("' + text + '")');
    }

    // 7. role + name
    if (el.getAttribute('role')) {
      const role = el.getAttribute('role');
      const name = el.getAttribute('aria-label') || el.textContent.trim().substring(0, 30);
      if (name) selectors.push('[role="' + role + '"]');
    }

    // 8. CSS path (least specific fallback)
    selectors.push(getCssPath(el));

    return selectors;
  }

  function getCssPath(el) {
    const parts = [];
    let current = el;
    while (current && current !== document.body) {
      let selector = current.tagName.toLowerCase();
      if (current.className && typeof current.className === 'string') {
        const classes = current.className.trim().split(/\\s+/).filter(c => c && !c.match(/^(hover|active|focus|selected)/)).slice(0, 2);
        if (classes.length) selector += '.' + classes.join('.');
      }
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector += ':nth-of-type(' + index + ')';
        }
      }
      parts.unshift(selector);
      current = current.parentElement;
    }
    return parts.join(' > ');
  }

  function getInputValue(el) {
    if (el.tagName === 'SELECT') return el.options[el.selectedIndex]?.value || '';
    return el.value || '';
  }

  // Capture clicks (skip SELECT elements — handled by change listener)
  document.addEventListener('click', function(e) {
    const el = e.target.closest('button, a, input[type="submit"], input[type="button"], [role="button"], label, [onclick]') || e.target;
    if (el.tagName === 'SELECT' || el.tagName === 'OPTION') return;
    const step = {
      type: 'click',
      selectors: generateSelectors(el),
      description: 'Click: ' + (el.textContent || el.tagName).trim().substring(0, 60),
      timestamp: Date.now()
    };
    window.__recordedSteps.push(step);
    if (window.__reportStep) window.__reportStep(JSON.stringify(step));
  }, true);

  // Capture input changes (debounced, skip SELECT — handled by change listener)
  let inputTimer = null;
  document.addEventListener('input', function(e) {
    const el = e.target;
    if (!el || !el.tagName || el.tagName === 'SELECT') return;
    clearTimeout(inputTimer);
    inputTimer = setTimeout(function() {
      const step = {
        type: 'fill',
        selectors: generateSelectors(el),
        value: getInputValue(el),
        description: 'Fill: ' + (el.name || el.id || el.placeholder || 'input'),
        timestamp: Date.now()
      };
      window.__recordedSteps.push(step);
      if (window.__reportStep) window.__reportStep(JSON.stringify(step));
    }, 500);
  }, true);

  // Capture select changes (single canonical handler for dropdowns)
  document.addEventListener('change', function(e) {
    const el = e.target;
    if (el.tagName !== 'SELECT') return;
    const step = {
      type: 'select',
      selectors: generateSelectors(el),
      value: el.value,
      description: 'Select: ' + (el.name || el.id || 'dropdown') + ' = ' + (el.options[el.selectedIndex]?.text || el.value),
      timestamp: Date.now()
    };
    window.__recordedSteps.push(step);
    if (window.__reportStep) window.__reportStep(JSON.stringify(step));
  }, true);

  console.log('[workflow-recorder] Recording started — interact with the page.');
})();
`;

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function recordWorkflow(): Promise<void> {
  const name = process.argv.find((a) => a.startsWith("--name="))?.split("=")[1]
    ?? await prompt("Workflow name (e.g. maintenance-request): ");

  if (!name) {
    console.error("Workflow name is required");
    process.exit(1);
  }

  console.log("=== Browser Workflow Recorder ===\n");
  console.log("This will open a Browserbase session. You perform the actions,");
  console.log("and the recorder captures each step as a replayable workflow.\n");

  const client = new Browserbase({ apiKey: config.browserbase.apiKey });
  let session: { id: string; connectUrl: string } | null = null;
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | null = null;

  try {
  // Create session with debug URL for live viewing
  console.log("Creating Browserbase session...");
  session = await client.sessions.create({
    projectId: config.browserbase.projectId,
    browserSettings: { solveCaptchas: true },
  });

  // Get the live debug URL
  const debugInfo = await client.sessions.debug(session.id);
  console.log("\n📺 LIVE VIEW — Open this URL in your browser to see and interact:");
  console.log(`   ${debugInfo.debuggerFullscreenUrl}\n`);

  browser = await chromium.connectOverCDP(session.connectUrl);
  const context: BrowserContext = browser.contexts()[0];
  const page: Page = context.pages()[0] ?? await context.newPage();

  const steps: WorkflowStep[] = [];
  let startUrl = "";

  // Expose function for the recording script to report steps
  await page.exposeFunction("__reportStep", (stepJson: string) => {
    const step = JSON.parse(stepJson) as WorkflowStep;
    steps.push(step);
    const desc = step.description ?? `${step.type}`;
    console.log(`  📝 Step ${steps.length}: ${desc}`);
  });

  // Inject recording script on every navigation
  await context.addInitScript(RECORDING_SCRIPT);

  // Also inject into current page
  await page.evaluate(RECORDING_SCRIPT);

  // Track navigations
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      const url = frame.url();
      if (!startUrl) startUrl = url;
      console.log(`  🔗 Navigated to: ${url}`);
    }
  });

  // Auto-login before recording so user doesn't have to deal with CAPTCHA
  console.log("Logging into RentCafe automatically...");
  const { login } = await import("../auth.js");
  const { isLoggedIn } = await import("../browser.js");

  await page.goto(config.rentcafe.url, { waitUntil: "domcontentloaded", timeout: 60_000 });

  // Wait for Cloudflare to resolve
  console.log("Waiting for Cloudflare to resolve...");
  await page.waitForTimeout(10_000);

  // Check if already logged in (persistent cookies)
  if (await isLoggedIn(page)) {
    console.log("Already logged in via saved cookies!");
  } else {
    // Run full login flow (email + Gmail API OTP auto-read)
    console.log("Not logged in — running auto-login (Gmail API will read OTP)...");
    const loginOk = await login(page);
    if (!loginOk) {
      console.error("Login failed. Make sure Gmail API is configured for auto-OTP.");
      console.error("Check your .env: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN");
      return;
    }
    console.log("Login successful!");
  }

  // Now logged in — set start URL to wherever we are post-login
  startUrl = page.url();

  // Re-inject recording script after login navigation
  await page.evaluate(RECORDING_SCRIPT);

  console.log("\n✅ Logged in! You can now record your workflow.");
  console.log("   Open the live view URL above and navigate to the form you want to record.");
  console.log("   The recorder captures clicks, form fills, and dropdown selections.");
  console.log("   Press Enter here when you're done recording.\n");

  await prompt("Press Enter when finished recording...");

  // Collect any remaining steps from the page
  const pageSteps = await page.evaluate(() =>
    (window as unknown as { __recordedSteps: unknown[] }).__recordedSteps ?? []
  );

  // Merge any steps we might have missed
  if (pageSteps.length > steps.length) {
    const extraSteps = (pageSteps as WorkflowStep[]).slice(steps.length);
    steps.push(...extraSteps);
  }

  console.log(`\n📋 Recorded ${steps.length} steps.`);

  if (steps.length === 0) {
    console.log("No steps recorded. Make sure you interact with the page in the live view.");
    return;
  }

  // Ask about variables
  console.log("\nWhich values should be dynamic (replaced at runtime)?");
  console.log("For each step with a value, you can mark it as a variable.\n");

  const variables: string[] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if ((step.type === "fill" || step.type === "select") && step.value) {
      const varName = await prompt(
        `  Step ${i + 1} (${step.description}) has value "${step.value}"\n` +
        `  Variable name (or Enter to keep as-is): `
      );
      if (varName) {
        variables.push(varName);
        step.value = `{{${varName}}}`;
      }
    }
  }

  // Build workflow
  const workflow: Workflow = {
    name,
    description: await prompt("\nBrief description of this workflow: ") || name,
    variables,
    startUrl,
    steps,
    recordedAt: new Date().toISOString(),
    version: 1,
  };

  // Save workflow
  const outPath = path.resolve("workflows", `${name}.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(workflow, null, 2));
  console.log(`\n✅ Workflow saved to: ${outPath}`);
  console.log(`   Run it with: npm run replay -- --workflow=${name}`);

  } finally {
    // Always release the Browserbase session
    try {
      if (browser) await browser.close();
    } catch { /* best-effort */ }
    if (session) {
      try {
        await client.sessions.update(session.id, {
          projectId: config.browserbase.projectId,
          status: "REQUEST_RELEASE",
        });
      } catch { /* best-effort */ }
    }
  }

  process.exit(0);
}

// CLI entry point
recordWorkflow().catch((err) => {
  console.error("Recorder error:", err);
  process.exit(1);
});
