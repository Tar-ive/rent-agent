import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

const COOKIES_PATH = path.join(config.browser.dataDir, "cookies.json");

let browser: Browser | null = null;
let context: BrowserContext | null = null;

export async function launchBrowser(): Promise<BrowserContext> {
  if (context) return context;

  fs.mkdirSync(config.browser.dataDir, { recursive: true });

  browser = await chromium.launch({
    headless: config.browser.headless,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
    ],
  });

  context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
  });

  await loadCookies(context);
  return context;
}

export async function getPage(): Promise<Page> {
  const ctx = await launchBrowser();
  const pages = ctx.pages();
  return pages.length > 0 ? pages[0] : await ctx.newPage();
}

export async function saveCookies(ctx?: BrowserContext): Promise<void> {
  const target = ctx ?? context;
  if (!target) return;
  const cookies = await target.cookies();
  fs.mkdirSync(path.dirname(COOKIES_PATH), { recursive: true });
  fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));
  console.log(`[browser] Saved ${cookies.length} cookies`);
}

async function loadCookies(ctx: BrowserContext): Promise<void> {
  if (!fs.existsSync(COOKIES_PATH)) return;
  try {
    const raw = fs.readFileSync(COOKIES_PATH, "utf-8");
    const cookies = JSON.parse(raw);
    await ctx.addCookies(cookies);
    console.log(`[browser] Loaded ${cookies.length} cookies from disk`);
  } catch {
    console.warn("[browser] Failed to load cookies, starting fresh");
  }
}

export async function closeBrowser(): Promise<void> {
  if (context) {
    await saveCookies(context);
    await context.close();
    context = null;
  }
  if (browser) {
    await browser.close();
    browser = null;
  }
}

export async function isLoggedIn(page: Page): Promise<boolean> {
  const url = page.url();
  // If we're on the login page, we're not logged in
  if (url.includes("userlogin") || url.includes("login")) return false;
  // Check for common logged-in indicators on RentCafe
  const logoutLink = await page.$('a[href*="logout"], a[href*="signout"], .logout, #logout');
  return logoutLink !== null;
}
