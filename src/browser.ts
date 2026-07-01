import Browserbase from "@browserbasehq/sdk";
import { chromium, type Browser, type Page } from "playwright";
import { config } from "./config.js";

let bb: Browserbase | null = null;
let browser: Browser | null = null;
let sessionId: string | null = null;
let contextId: string | null = null;
let launchPromise: Promise<Browser> | null = null;

function getClient(): Browserbase {
  if (!bb) {
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
  console.log("[browser] Created new persistent context");
  return ctx.id;
}

export async function launchBrowser(): Promise<Browser> {
  if (browser?.isConnected()) return browser;
  if (launchPromise) return launchPromise;

  launchPromise = (async () => {
    const client = getClient();
    contextId = await getOrCreateContext();

    console.log("[browser] Creating Browserbase session...");
    let newSessionId: string | null = null;
    try {
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

      newSessionId = session.id;
      console.log("[browser] Session created");

      browser = await chromium.connectOverCDP(session.connectUrl);
      sessionId = newSessionId;
      console.log("[browser] Playwright connected via CDP");

      return browser;
    } catch (err) {
      if (newSessionId) {
        try {
          await client.sessions.update(newSessionId, {
            projectId: config.browserbase.projectId,
            status: "REQUEST_RELEASE",
          });
        } catch {
          // best-effort cleanup
        }
      }
      browser = null;
      sessionId = null;
      throw err;
    } finally {
      launchPromise = null;
    }
  })();

  return launchPromise;
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
  // Cookies persist via Browserbase context automatically
}

export async function closeBrowser(): Promise<void> {
  const sid = sessionId;
  try {
    if (browser) {
      await browser.close();
      browser = null;
    }
  } catch (err) {
    console.warn("[browser] Error closing browser:", err);
    browser = null;
  } finally {
    if (sid) {
      try {
        const client = getClient();
        await client.sessions.update(sid, {
          projectId: config.browserbase.projectId,
          status: "REQUEST_RELEASE",
        });
        console.log("[browser] Session released");
      } catch (err) {
        console.warn("[browser] Failed to release session:", err);
      }
      sessionId = null;
    }
  }
}

export async function isLoggedIn(page: Page): Promise<boolean> {
  const url = page.url();
  if (url.includes("userlogin") || url.includes("login")) return false;
  const logoutLink = await page.$(
    'a[href*="logout"], a[href*="signout"], .logout, #logout, a:has-text("Sign Out"), a:has-text("Log Out")'
  );
  return logoutLink !== null;
}

export function getContextId(): string | null {
  return contextId;
}
