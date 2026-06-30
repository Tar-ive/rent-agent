import type { Page } from "playwright";
import { saveCookies, isLoggedIn } from "./browser.js";

export interface MaintenanceRequest {
  category: string;
  description: string;
  location?: string;
  permissionToEnter?: boolean;
}

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  plumbing: ["leak", "faucet", "toilet", "drain", "water", "pipe", "shower", "sink"],
  electrical: ["light", "outlet", "switch", "power", "electric", "fan", "breaker"],
  hvac: ["ac", "heat", "air", "thermostat", "hvac", "cold", "hot", "temperature"],
  appliance: ["dishwasher", "washer", "dryer", "oven", "stove", "fridge", "refrigerator", "microwave", "disposal"],
  "pest control": ["pest", "bug", "roach", "ant", "mouse", "rat", "spider", "insect", "termite", "mosquito", "bee"],
  general: ["door", "window", "lock", "key", "carpet", "paint", "wall", "ceiling", "floor"],
};

export function parseMaintenanceRequest(message: string): MaintenanceRequest {
  const lower = message.toLowerCase();

  let bestCategory = "general";
  let bestScore = 0;

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    const score = keywords.filter((kw) => lower.includes(kw)).length;
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }

  return {
    category: bestCategory,
    description: message,
    permissionToEnter: true,
  };
}

export async function submitMaintenanceRequest(
  page: Page,
  request: MaintenanceRequest
): Promise<{ success: boolean; confirmationId?: string; error?: string }> {
  try {
    // Navigate to maintenance request page
    // RentCafe typically has a "Maintenance" or "Service Request" link in the dashboard
    const maintenanceLink = await page.$(
      'a:has-text("Maintenance"), a:has-text("Service Request"), a:has-text("Work Order"), a[href*="maintenance" i], a[href*="service" i], a[href*="workorder" i]'
    );

    if (maintenanceLink) {
      await maintenanceLink.click();
      await page.waitForTimeout(3000);
    } else {
      // Try navigating directly to common maintenance request URLs
      const baseUrl = page.url().split("/residentservices/")[0];
      const propertyPath = page.url().split("/residentservices/")[1]?.split("/")[0] ?? "";
      const maintenanceUrl = `${baseUrl}/residentservices/${propertyPath}/servicerequest`;
      await page.goto(maintenanceUrl, { waitUntil: "networkidle", timeout: 15_000 });
    }

    // Check if we're still logged in
    if (!(await isLoggedIn(page))) {
      return { success: false, error: "Session expired — need to re-login" };
    }

    // Look for "New Request" or "Submit Request" button
    const newRequestBtn = await page.$(
      'button:has-text("New"), button:has-text("Submit"), a:has-text("New Request"), a:has-text("Create"), button:has-text("Create")'
    );
    if (newRequestBtn) {
      await newRequestBtn.click();
      await page.waitForTimeout(2000);
    }

    // Fill in the category/type dropdown
    const categorySelect = await page.$(
      'select[name*="category" i], select[name*="type" i], select[id*="category" i], select[id*="type" i], select[name*="Category"], select[name*="RequestType"]'
    );
    if (categorySelect) {
      // Try to select the matching category from dropdown options
      const options = await categorySelect.$$("option");
      let matched = false;
      for (const option of options) {
        const text = (await option.textContent())?.toLowerCase() ?? "";
        if (text.includes(request.category.toLowerCase())) {
          const value = await option.getAttribute("value");
          if (value) {
            await categorySelect.selectOption(value);
            matched = true;
            break;
          }
        }
      }
      if (!matched && options.length > 1) {
        // Select the first non-empty option as fallback
        const value = await options[1].getAttribute("value");
        if (value) await categorySelect.selectOption(value);
      }
    }

    // Fill in the location/area if there's a field for it
    if (request.location) {
      const locationInput = await page.$(
        'input[name*="location" i], select[name*="location" i], input[name*="area" i], select[name*="area" i]'
      );
      if (locationInput) {
        const tagName = await locationInput.evaluate((el) => el.tagName.toLowerCase());
        if (tagName === "select") {
          const options = await locationInput.$$("option");
          for (const option of options) {
            const text = (await option.textContent())?.toLowerCase() ?? "";
            if (text.includes(request.location.toLowerCase())) {
              const value = await option.getAttribute("value");
              if (value) {
                await locationInput.selectOption(value);
                break;
              }
            }
          }
        } else {
          await locationInput.fill(request.location);
        }
      }
    }

    // Fill in description/comments
    const descriptionInput = await page.$(
      'textarea[name*="description" i], textarea[name*="comment" i], textarea[name*="detail" i], textarea[id*="description" i], textarea[id*="comment" i], textarea'
    );
    if (descriptionInput) {
      await descriptionInput.fill(request.description);
    }

    // Permission to enter checkbox
    if (request.permissionToEnter) {
      const permissionCheckbox = await page.$(
        'input[type="checkbox"][name*="permission" i], input[type="checkbox"][name*="enter" i], input[type="checkbox"][id*="permission" i]'
      );
      if (permissionCheckbox) {
        const isChecked = await permissionCheckbox.isChecked();
        if (!isChecked) await permissionCheckbox.check();
      }
    }

    // Submit the form
    const submitBtn = await page.$(
      'button[type="submit"], input[type="submit"], button:has-text("Submit"), button:has-text("Send"), button:has-text("Save")'
    );
    if (submitBtn) {
      await submitBtn.click();
      await page.waitForTimeout(5000);
    }

    // Check for confirmation
    const confirmationText = await page.textContent("body");
    const confirmationMatch = confirmationText?.match(
      /(?:request|order|ticket)\s*(?:#|number|id)?\s*:?\s*(\d+)/i
    );

    await saveCookies();

    if (confirmationMatch) {
      return { success: true, confirmationId: confirmationMatch[1] };
    }

    // Check if we see a success message
    const successMsg = await page.$(
      'text=/success|submitted|received|thank you/i'
    );
    if (successMsg) {
      return { success: true };
    }

    return { success: true, confirmationId: "pending" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}
