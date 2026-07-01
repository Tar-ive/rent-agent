/**
 * CLI entry point for replaying a recorded workflow.
 *
 * Usage:
 *   npm run replay -- --workflow=maintenance-request --description="leaky faucet in kitchen"
 *   npm run replay -- --workflow=pest-control
 *
 * Variables are passed as --varName="value" arguments.
 */

import { launchBrowser, getPage, closeBrowser, isLoggedIn } from "../browser.js";
import { login } from "../auth.js";
import { loadWorkflow, replayWorkflow } from "./replayer.js";

async function main(): Promise<void> {
  // Parse args
  const args = process.argv.slice(2);
  const workflowName = args.find((a) => a.startsWith("--workflow="))?.split("=")[1];

  if (!workflowName) {
    console.error("Usage: npm run replay -- --workflow=<name> [--var1=value1] [--var2=value2]");
    console.error("\nAvailable workflows:");
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dir = path.resolve("workflows");
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir)) {
        if (f.endsWith(".json")) console.error(`  - ${f.replace(".json", "")}`);
      }
    } else {
      console.error("  (none yet — run 'npm run record' first)");
    }
    process.exit(1);
  }

  // Parse variables from remaining args
  const variables: Record<string, string> = {};
  for (const arg of args) {
    if (arg.startsWith("--") && arg.includes("=") && !arg.startsWith("--workflow=")) {
      const [key, ...valueParts] = arg.slice(2).split("=");
      variables[key] = valueParts.join("=");
    }
  }

  // Load workflow
  const workflow = loadWorkflow(workflowName);
  console.log(`[replay] Loaded workflow: ${workflow.name}`);
  console.log(`[replay] Description: ${workflow.description}`);
  console.log(`[replay] Steps: ${workflow.steps.length}`);

  // Check required variables
  const missing = workflow.variables.filter((v) => !(v in variables));
  if (missing.length > 0) {
    console.error(`\nMissing required variables: ${missing.map((v) => `--${v}=...`).join(" ")}`);
    process.exit(1);
  }

  // Launch browser and ensure logged in
  await launchBrowser();
  const page = await getPage();

  if (!(await isLoggedIn(page))) {
    console.log("[replay] Not logged in, attempting login...");
    const ok = await login(page);
    if (!ok) {
      console.error("[replay] Login failed. Run 'npm run login' first.");
      await closeBrowser();
      process.exit(1);
    }
  }

  // Replay the workflow
  const result = await replayWorkflow(page, workflow, {
    variables,
    screenshots: true,
    stopOnError: true,
  });

  if (result.success) {
    console.log(`\n✅ Workflow completed successfully (${result.stepsCompleted} steps)`);
  } else {
    console.error(`\n❌ Workflow failed at step ${result.stepsCompleted + 1}: ${result.error}`);
  }

  await closeBrowser();
  process.exit(result.success ? 0 : 1);
}

main().catch((err) => {
  console.error("Replay error:", err);
  process.exit(1);
});
