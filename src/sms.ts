import twilio from "twilio";
import { config } from "./config.js";

let client: twilio.Twilio | null = null;

function getClient(): twilio.Twilio {
  if (!client) {
    if (!config.twilio.accountSid || !config.twilio.authToken) {
      throw new Error("Twilio credentials not configured — set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN");
    }
    client = twilio(config.twilio.accountSid, config.twilio.authToken);
  }
  return client;
}

export async function sendSms(body: string): Promise<void> {
  if (!config.twilio.accountSid || !config.twilio.phoneNumber || !config.userPhoneNumber) {
    console.log(`[sms] (not configured) Would send: ${body}`);
    return;
  }
  try {
    const message = await getClient().messages.create({
      body,
      from: config.twilio.phoneNumber,
      to: config.userPhoneNumber,
    });
    console.log(`[sms] Sent message ${message.sid}: ${body}`);
  } catch (error) {
    console.error("[sms] Failed to send:", error);
  }
}
