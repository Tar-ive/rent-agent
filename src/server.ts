import express from "express";
import { config } from "./config.js";
import { supplyOtp } from "./auth.js";
import { handleIncomingSms } from "./handler.js";

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const app = express();

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Twilio SMS webhook — receives incoming messages from the user
app.post("/sms", (req, res) => {
  const body: string = req.body.Body?.trim() ?? "";
  const from: string = req.body.From ?? "";

  // Verify sender is the authorized user
  if (config.userPhoneNumber && from !== config.userPhoneNumber) {
    console.warn(`[server] Rejected SMS from unauthorized number: ${from}`);
    res.type("text/xml").send("<Response></Response>");
    return;
  }

  console.log(`[server] Incoming SMS from authorized user: ${body}`);

  // Check if this is an OTP code (4-8 digit number)
  if (/^\d{4,8}$/.test(body)) {
    console.log("[server] Detected OTP code, supplying to auth flow...");
    supplyOtp(body);
    res.type("text/xml").send("<Response><Message>Code received, logging in...</Message></Response>");
    return;
  }

  // Handle asynchronously — return acknowledgement immediately to avoid Twilio timeout
  res.type("text/xml").send(`<Response><Message>Processing your request...</Message></Response>`);

  handleIncomingSms(body, from)
    .then(async (reply) => {
      // Send result as a follow-up SMS since webhook already responded
      const { sendSms } = await import("./sms.js");
      await sendSms(reply);
    })
    .catch((err) => {
      console.error("[server] Error handling SMS:", err);
      import("./sms.js").then(({ sendSms }) =>
        sendSms("Something went wrong processing your request. Please try again.")
      ).catch(() => {});
    });
});

export function startServer(): void {
  app.listen(config.port, () => {
    console.log(`[server] Listening on port ${config.port}`);
    console.log(`[server] SMS webhook: POST http://localhost:${config.port}/sms`);
  });
}
