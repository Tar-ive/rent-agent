import "dotenv/config";

export const config = {
  rentcafe: {
    url:
      process.env.RENTCAFE_URL ??
      "https://atlanticpalazzoliving.securecafenet.com/residentservices/the-atlantic-palazzo-living/userlogin",
    email: process.env.RENTCAFE_EMAIL ?? "",
  },
  browserbase: {
    apiKey: process.env.BROWSERBASE_API_KEY ?? "",
    projectId: process.env.BROWSERBASE_PROJECT_ID ?? "",
    contextId: process.env.BROWSERBASE_CONTEXT_ID ?? "rentcafe-session",
  },
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID ?? "",
    authToken: process.env.TWILIO_AUTH_TOKEN ?? "",
    phoneNumber: process.env.TWILIO_PHONE_NUMBER ?? "",
  },
  userPhoneNumber: process.env.USER_PHONE_NUMBER ?? "",
  port: Number(process.env.PORT ?? 3000),
  pestControlCron: process.env.PEST_CONTROL_CRON ?? "0 9 * * 1",
} as const;
