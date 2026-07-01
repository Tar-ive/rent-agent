import Browserbase from "@browserbasehq/sdk";
import { chromium, type Browser, type Page } from "playwright";
import { config } from "./config.js";

let bb: Browserbase | null = null;
let browser: Browser | null = null;
let sessionId: string | null = null;
let contextId: string | null = null;

function getClient(): Browserbase {
  if (!bb) {
    if (!config.browserbase.apiKey) {
      throw new Error("BROWSERBASE_API_KEY is not set");
    }
    bb = new Browserbase({ apiKey: config.browserbase.apiKey });
  }
  return bb;
}

async function getOrCreateContext(): Promise<string> {
  if (config.browserbase.contextId) return config.browserbase.contextId;

  const client = getClient();
  const ctx = await client.contexts.create({
    projectId: config.browserbase.projectId,
  });
  console.log(`[browser] Created new context: ${ctx.id}`);
  return ctx.id;
}

export async function launchBrowser(): Promise<Browser> {
  if (browser?.isConnected()) return browser;

  const client = getClient();
  contextId = await getOrCreateContext();

  console.log("[browser] Creating Browserbase session...");
  const session = await client.sessions.create({
    projectId: config.browserbase.projectId,
    browserSettings: {
      solveCaptchas: true,
      context: {
        id: contextId,
        persist: true,
      },
    },
  });

  sessionId = session.id;
  console.log(`[browser] Session created: ${session.id}`);
  console.log(`[browser] Replay: https://browserbase.com/sessions/${session.id}`);

  browser = await chromium.connectOverCDP(session.connectUrl);
  console.log("[browser] Playwright connected via CDP");

  return browser;
}

export async function getPage(): Promise<Page> {
  const b = await launchBrowser();
  const contexts = b.contexts();
  if (contexts.length > 0 && contexts[0].pages().length > 0) {
    return contexts[0].pages()[0];
  }
  const context = contexts.length > 0 ? contexts[0] : await b.newContext();
  return await context.newPage();
}

export async function saveCookies(): Promise<void> {
  console.log("[browser] Cookies persist via Browserbase context");
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }

  if (sessionId) {
    try {
      const client = getClient();
      await client.sessions.update(sessionId, {
        projectId: config.browserbase.projectId,
        status: "REQUEST_RELEASE",
      });
      console.log(`[browser] Session ${sessionId} released`);
    } catch (err) {
      console.warn("[browser] Failed to release session:", err);
    }
    sessionId = null;
  }
}

export async function isLoggedIn(page: Page): Promise<boolean> {
  const url = page.url();
  if (url.includes("userlogin") || url.includes("login")) return false;
  // Check for dashboard-like elements that appear after login
  const logoutLink = await page.$(
    'a[href*="logout"], a[href*="signout"], .logout, #logout, a:has-text("Sign Out"), a:has-text("Log Out")'
  );
  return logoutLink !== null;
}

export function getContextId(): string | null {
  return contextId;
}
