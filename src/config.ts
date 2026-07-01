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
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID ?? "",
    authToken: process.env.TWILIO_AUTH_TOKEN ?? "",
    phoneNumber: process.env.TWILIO_PHONE_NUMBER ?? "",
  },
  userPhoneNumber: process.env.USER_PHONE_NUMBER ?? "",
  port: Number.isFinite(Number(process.env.PORT)) ? Number(process.env.PORT) : 3000,
  pestControlCron: process.env.PEST_CONTROL_CRON ?? "0 9 * * 1",
} as const;
