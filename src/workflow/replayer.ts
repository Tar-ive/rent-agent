/**
 * Browser Workflow Replayer
 *
 * Loads a recorded workflow JSON, substitutes dynamic variables,
 * and executes each step using Playwright against a Browserbase session.
 *
 * Features:
 * - Multiple selector fallbacks per step (tries each until one matches)
 * - Variable interpolation: {{varName}} replaced with provided values
 * - Configurable step timeout and retry logic
 * - Screenshot capture between steps (optional)
 * - Graceful error handling with partial completion reporting
 *
 * Usage: npm run replay -- --workflow=maintenance-request --description="leaky faucet"
 */

import type { Page } from "playwright";
import type { Workflow, WorkflowStep, ReplayOptions, ReplayResult } from "./types.js";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_STEP_TIMEOUT = 15_000;
const STEP_DELAY = 1000;

export function loadWorkflow(nameOrPath: string): Workflow {
  // Try direct path first, then workflows/ directory
  let filePath = nameOrPath;
  if (!fs.existsSync(filePath)) {
    filePath = path.resolve("workflows", `${nameOrPath}.json`);
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(`Workflow not found: ${nameOrPath} (tried ${filePath})`);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as Workflow;
}

function interpolate(text: string, variables: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    if (!(key in variables)) {
      throw new Error(`Missing variable: {{${key}}}. Required variables: ${Object.keys(variables).join(", ")}`);
    }
    return variables[key];
  });
}

async function findElement(page: Page, selectors: string[], timeout: number) {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    for (const selector of selectors) {
      try {
        const el = await page.$(selector);
        if (el) {
          // Verify element is visible and interactable
          const visible = await el.isVisible();
          if (visible) return el;
        }
      } catch {
        // Selector syntax might not be valid for this page, try next
      }
    }
    await page.waitForTimeout(500);
  }

  return null;
}

export async function replayWorkflow(
  page: Page,
  workflow: Workflow,
  options: ReplayOptions
): Promise<ReplayResult> {
  const { variables, stepTimeout = DEFAULT_STEP_TIMEOUT, stopOnError = true } = options;
  const screenshots: string[] = [];

  // Validate all required variables are provided
  for (const varName of workflow.variables) {
    if (!(varName in variables)) {
      return {
        success: false,
        stepsCompleted: 0,
        totalSteps: workflow.steps.length,
        error: `Missing required variable: ${varName}`,
      };
    }
  }

  console.log(`[replayer] Executing workflow: ${workflow.name} (${workflow.steps.length} steps)`);

  // Navigate to the recorded start URL before executing steps
  if (workflow.startUrl) {
    console.log(`[replayer] Navigating to start URL: ${workflow.startUrl}`);
    await page.goto(workflow.startUrl, { waitUntil: "domcontentloaded", timeout: stepTimeout });
    await page.waitForTimeout(STEP_DELAY);
  }

  let stepsCompleted = 0;

  for (let i = 0; i < workflow.steps.length; i++) {
    const step = workflow.steps[i];
    const desc = step.description ?? `${step.type} step ${i + 1}`;
    console.log(`[replayer] Step ${i + 1}/${workflow.steps.length}: ${desc}`);

    try {
      await executeStep(page, step, variables, stepTimeout);
      stepsCompleted++;

      if (options.screenshots) {
        const screenshotPath = `/tmp/workflow-step-${i + 1}.png`;
        await page.screenshot({ path: screenshotPath });
        screenshots.push(screenshotPath);
      }

      // Small delay between steps for page to settle
      await page.waitForTimeout(STEP_DELAY);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[replayer] Step ${i + 1} failed: ${errMsg}`);

      if (stopOnError) {
        return {
          success: false,
          stepsCompleted,
          totalSteps: workflow.steps.length,
          error: `Step ${i + 1} (${desc}) failed: ${errMsg}`,
          screenshots,
        };
      }
    }
  }

  console.log(`[replayer] Workflow complete: ${stepsCompleted}/${workflow.steps.length} steps`);

  return {
    success: stepsCompleted === workflow.steps.length,
    stepsCompleted,
    totalSteps: workflow.steps.length,
    screenshots,
  };
}

async function executeStep(
  page: Page,
  step: WorkflowStep,
  variables: Record<string, string>,
  timeout: number
): Promise<void> {
  switch (step.type) {
    case "navigate": {
      const url = step.url ? interpolate(step.url, variables) : "";
      if (!url) throw new Error("Navigate step missing url");
      await page.goto(url, { waitUntil: "domcontentloaded", timeout });
      break;
    }

    case "wait": {
      const duration = step.duration ?? 2000;
      await page.waitForTimeout(duration);
      break;
    }

    case "click": {
      if (!step.selectors?.length) throw new Error("Click step missing selectors");
      const el = await findElement(page, step.selectors, timeout);
      if (!el) {
        throw new Error(`Element not found: ${step.selectors[0]} (tried ${step.selectors.length} selectors)`);
      }
      await el.click();
      break;
    }

    case "fill": {
      if (!step.selectors?.length) throw new Error("Fill step missing selectors");
      const value = step.value ? interpolate(step.value, variables) : "";
      const el = await findElement(page, step.selectors, timeout);
      if (!el) {
        throw new Error(`Element not found: ${step.selectors[0]} (tried ${step.selectors.length} selectors)`);
      }
      await el.fill(value);
      break;
    }

    case "select": {
      if (!step.selectors?.length) throw new Error("Select step missing selectors");
      const value = step.value ? interpolate(step.value, variables) : "";
      const el = await findElement(page, step.selectors, timeout);
      if (!el) {
        throw new Error(`Element not found: ${step.selectors[0]} (tried ${step.selectors.length} selectors)`);
      }
      await el.selectOption(value);
      break;
    }

    case "screenshot": {
      const screenshotPath = step.value ?? "/tmp/workflow-screenshot.png";
      await page.screenshot({ path: screenshotPath });
      break;
    }

    case "assert": {
      if (!step.assertion) throw new Error("Assert step missing assertion");
      const text = interpolate(step.assertion, variables);
      const found = await page.locator(`text=${text}`).isVisible().catch(() => false);
      if (!found) {
        throw new Error(`Assertion failed: expected text "${text}" not found on page`);
      }
      break;
    }

    default:
      throw new Error(`Unknown step type: ${(step as WorkflowStep).type}`);
  }
}
