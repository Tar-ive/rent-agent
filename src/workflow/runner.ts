/**
 * Workflow runner — used by the handler to execute workflows programmatically.
 * This bridges the Telegram/SMS handler with the workflow replayer.
 */

import type { Page } from "playwright";
import { loadWorkflow, replayWorkflow } from "./replayer.js";
import type { ReplayResult } from "./types.js";
import fs from "node:fs";
import path from "node:path";

export function hasWorkflow(name: string): boolean {
  const filePath = path.resolve("workflows", `${name}.json`);
  return fs.existsSync(filePath);
}

export function listWorkflows(): string[] {
  const dir = path.resolve("workflows");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(".json", ""));
}

export async function runWorkflow(
  page: Page,
  workflowName: string,
  variables: Record<string, string>
): Promise<ReplayResult> {
  const workflow = loadWorkflow(workflowName);
  return replayWorkflow(page, workflow, {
    variables,
    stepTimeout: 15_000,
    stopOnError: true,
  });
}
