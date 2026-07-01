import "dotenv/config";

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

export const config = {
  rentcafe: {
    url:
      process.env.RENTCAFE_URL ??
      "https://atlanticpalazzoliving.securecafenet.com/residentservices/the-atlantic-palazzo-living/userlogin",
    email: process.env.RENTCAFE_EMAIL ?? "",
  },
  browserbase: {
    apiKey: requireEnv("BROWSERBASE_API_KEY"),
    projectId: requireEnv("BROWSERBASE_PROJECT_ID"),
    contextId: process.env.BROWSERBASE_CONTEXT_ID ?? "",
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
    chatId: process.env.TELEGRAM_CHAT_ID ?? "",
  },
  gmail: {
    clientId: process.env.GMAIL_CLIENT_ID ?? "",
    clientSecret: process.env.GMAIL_CLIENT_SECRET ?? "",
    refreshToken: process.env.GMAIL_REFRESH_TOKEN ?? "",
    otpSender: process.env.GMAIL_OTP_SENDER ?? "rentcafe.com",
  },
  captcha: {
    apiKey: process.env.CAPTCHA_API_KEY ?? "",
    standardSiteKey: process.env.CAPTCHA_SITE_KEY ?? "6Led3AcTAAAAAMU9N0MWjGzH1EM2ewS_DHHVol3p",
  },
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID ?? "",
    authToken: process.env.TWILIO_AUTH_TOKEN ?? "",
    phoneNumber: process.env.TWILIO_PHONE_NUMBER ?? "",
  },
  userPhoneNumber: process.env.USER_PHONE_NUMBER ?? "",
  port: Number.isFinite(Number(process.env.PORT)) ? Number(process.env.PORT) : 3000,
  pestControlCron: process.env.PEST_CONTROL_CRON ?? "0 9 * * 1",
} as const;
