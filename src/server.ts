import express from "express";
import { config } from "./config.js";
import { supplyOtp } from "./auth.js";
import { handleIncomingSms } from "./handler.js";

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

  console.log(`[server] Incoming SMS from ${from}: ${body}`);

  // Check if this is an OTP code (4-8 digit number)
  if (/^\d{4,8}$/.test(body)) {
    console.log("[server] Detected OTP code, supplying to auth flow...");
    supplyOtp(body);
    res.type("text/xml").send("<Response><Message>Code received, logging in...</Message></Response>");
    return;
  }

  // Otherwise treat it as a maintenance request
  handleIncomingSms(body, from)
    .then((reply) => {
      res.type("text/xml").send(`<Response><Message>${reply}</Message></Response>`);
    })
    .catch((err) => {
      console.error("[server] Error handling SMS:", err);
      res.type("text/xml").send("<Response><Message>Something went wrong. Please try again.</Message></Response>");
    });
});

export function startServer(): void {
  app.listen(config.port, () => {
    console.log(`[server] Listening on port ${config.port}`);
    console.log(`[server] SMS webhook: POST http://localhost:${config.port}/sms`);
  });
}
