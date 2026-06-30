import { getPage, isLoggedIn } from "./browser.js";
import { login } from "./auth.js";
import { parseMaintenanceRequest, submitMaintenanceRequest } from "./maintenance.js";
import { sendSms } from "./sms.js";

export async function handleIncomingSms(message: string, _from: string): Promise<string> {
  const lower = message.toLowerCase().trim();

  // Help command
  if (lower === "help" || lower === "?") {
    return [
      "Rent Agent commands:",
      "- Send a description to create a maintenance request (e.g. 'leaky faucet in bathroom')",
      "- 'pest control' - submit a pest control request",
      "- 'status' - check agent status",
      "- 'help' - show this message",
    ].join("\n");
  }

  // Status check
  if (lower === "status") {
    const page = await getPage();
    const loggedIn = await isLoggedIn(page);
    return loggedIn
      ? "Agent is running and logged into RentCafe."
      : "Agent is running but NOT logged into RentCafe. Send 'login' to re-authenticate.";
  }

  // Manual login trigger
  if (lower === "login") {
    const page = await getPage();
    const success = await login(page);
    return success ? "Login successful!" : "Login failed. Please check the browser window.";
  }

  // Pest control shortcut
  if (lower.includes("pest") || lower.includes("bug spray") || lower.includes("exterminator")) {
    return await submitRequest({
      category: "pest control",
      description: "Requesting scheduled pest control treatment for the unit.",
      permissionToEnter: true,
    });
  }

  // Parse and submit maintenance request
  const request = parseMaintenanceRequest(message);
  return await submitRequest(request);
}

async function submitRequest(request: {
  category: string;
  description: string;
  location?: string;
  permissionToEnter?: boolean;
}): Promise<string> {
  try {
    const page = await getPage();

    // Ensure we're logged in
    if (!(await isLoggedIn(page))) {
      console.log("[handler] Not logged in, attempting login...");
      const loginOk = await login(page);
      if (!loginOk) {
        return "Need to log in first. Check your email for a verification code and reply with it.";
      }
    }

    const result = await submitMaintenanceRequest(page, request);

    if (result.success) {
      const confMsg = result.confirmationId
        ? ` (Confirmation: ${result.confirmationId})`
        : "";
      return `Maintenance request submitted: ${request.category} - "${request.description}"${confMsg}`;
    }

    if (result.error?.includes("Session expired")) {
      return "Session expired. Send 'login' to re-authenticate, then try again.";
    }

    return `Failed to submit request: ${result.error ?? "unknown error"}`;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[handler] Submit error:", msg);
    return `Error: ${msg}`;
  }
}

export async function submitPestControlRequest(): Promise<void> {
  console.log("[scheduler] Submitting weekly pest control request...");
  const reply = await handleIncomingSms("pest control", "scheduler");
  console.log(`[scheduler] Result: ${reply}`);
  await sendSms(`[Scheduled] ${reply}`);
}
