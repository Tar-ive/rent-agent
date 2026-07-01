import { getPage, isLoggedIn } from "./browser.js";
import { login } from "./auth.js";
import { parseMaintenanceRequest, submitMaintenanceRequest } from "./maintenance.js";
import { sendNotification } from "./notify.js";
import { hasWorkflow, runWorkflow, listWorkflows } from "./workflow/runner.js";

export interface RequestContext {
  category?: string;
  location?: string;
  photos?: string[];
}

export async function handleIncomingSms(message: string, _from: string, context?: RequestContext): Promise<string> {
  const lower = message.toLowerCase().trim();

  // Help command
  if (lower === "help" || lower === "?" || lower === "/help") {
    const workflows = listWorkflows();
    const workflowList = workflows.length > 0
      ? `\nRecorded workflows: ${workflows.join(", ")}`
      : "\n(No workflows recorded yet — run 'npm run record' to create one)";

    return [
      "Rent Agent commands:",
      "- Send a description to create a maintenance request (e.g. 'leaky faucet in bathroom')",
      "- 'pest control' - submit a pest control request",
      "- 'status' - check agent status",
      "- 'login' - trigger re-authentication",
      "- 'workflows' - list recorded browser workflows",
      "- 'help' - show this message",
      workflowList,
    ].join("\n");
  }

  // Status check
  if (lower === "status" || lower === "/status") {
    const page = await getPage();
    const loggedIn = await isLoggedIn(page);
    return loggedIn
      ? "Agent is running and logged into RentCafe."
      : "Agent is running but NOT logged into RentCafe. Send 'login' to re-authenticate.";
  }

  // List workflows
  if (lower === "workflows" || lower === "/workflows") {
    const workflows = listWorkflows();
    if (workflows.length === 0) {
      return "No workflows recorded yet. Run 'npm run record' to create one.";
    }
    return `Recorded workflows:\n${workflows.map((w) => `• ${w}`).join("\n")}`;
  }

  // Manual login trigger
  if (lower === "login" || lower === "/login") {
    const page = await getPage();
    const success = await login(page);
    return success ? "Login successful!" : "Login failed. Please try again.";
  }

  // If interactive context is provided, use it directly
  if (context?.category) {
    const request = {
      category: context.category,
      description: message,
      location: context.location,
      permissionToEnter: true,
      photos: context.photos,
    };

    if (hasWorkflow("maintenance-request")) {
      return await executeWorkflow("maintenance-request", {
        category: request.category,
        description: request.description,
        location: request.location ?? "",
      }, request.photos);
    }
    return await submitRequest(request);
  }

  // Pest control shortcut — use workflow if available
  if (lower.includes("pest") || lower.includes("bug spray") || lower.includes("exterminator")) {
    if (hasWorkflow("pest-control")) {
      return await executeWorkflow("pest-control", {
        description: "Requesting scheduled pest control treatment for the apartment. Please treat all rooms including kitchen, bathrooms, and common areas.",
      });
    }
    return await submitRequest({
      category: "pest control",
      description: "Requesting scheduled pest control treatment for the apartment. Please treat all rooms including kitchen, bathrooms, and common areas.",
      permissionToEnter: true,
    });
  }

  // Try maintenance-request workflow if available
  if (hasWorkflow("maintenance-request")) {
    const request = parseMaintenanceRequest(message);
    return await executeWorkflow("maintenance-request", {
      category: request.category,
      description: request.description,
      location: request.location ?? "",
    });
  }

  // Fall back to generic form automation
  const request = parseMaintenanceRequest(message);
  return await submitRequest(request);
}

async function executeWorkflow(
  workflowName: string,
  variables: Record<string, string>,
  photos?: string[]
): Promise<string> {
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

    const result = await runWorkflow(page, workflowName, variables);

    if (result.success) {
      // Upload photos if any were provided
      if (photos && photos.length > 0) {
        await uploadPhotos(page, photos);
      }
      return `Request submitted via workflow "${workflowName}" (${result.stepsCompleted} steps completed)`;
    }

    return `Workflow "${workflowName}" failed at step ${result.stepsCompleted + 1}: ${result.error}`;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[handler] Workflow error:", msg);
    return `Workflow error: ${msg}`;
  }
}

async function uploadPhotos(page: import("playwright").Page, photos: string[]): Promise<void> {
  try {
    const fileInput = await page.$(
      'input[type="file"], input[accept*="image"], input[name*="photo" i], input[name*="file" i], input[name*="attachment" i]'
    );
    if (fileInput) {
      await fileInput.setInputFiles(photos);
      console.log(`[handler] Uploaded ${photos.length} photo(s)`);
      await page.waitForTimeout(2000);
    } else {
      console.warn("[handler] No file input found on page, photos not uploaded");
    }
  } catch (err) {
    console.warn("[handler] Failed to upload photos:", err);
  }
}

async function submitRequest(request: {
  category: string;
  description: string;
  location?: string;
  permissionToEnter?: boolean;
  photos?: string[];
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
      // Upload photos if provided
      if (request.photos && request.photos.length > 0) {
        await uploadPhotos(page, request.photos);
      }
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
  await sendNotification(`[Scheduled] ${reply}`);
}
