/**
 * Workflow types — defines the structure of recorded browser workflows.
 *
 * Inspired by OpenFang's Browser Hand and Playwright Codegen:
 * - Each workflow is a sequence of steps (click, fill, select, navigate, wait)
 * - Steps have robust selectors (multiple fallbacks)
 * - Dynamic variables use {{varName}} syntax for substitution at replay time
 */

export interface WorkflowStep {
  type: "click" | "fill" | "select" | "navigate" | "wait" | "screenshot" | "assert";
  /** Multiple selectors in priority order — replayer tries each until one matches */
  selectors?: string[];
  /** Value for fill/select steps. Supports {{variable}} interpolation */
  value?: string;
  /** URL for navigate steps */
  url?: string;
  /** Milliseconds for wait steps */
  duration?: number;
  /** Human-readable description of what this step does */
  description?: string;
  /** Optional: expected text/attribute to assert after this step */
  assertion?: string;
  /** Timestamp when recorded (ms since workflow start) */
  timestamp?: number;
}

export interface Workflow {
  /** Unique workflow name */
  name: string;
  /** Human description of what this workflow does */
  description: string;
  /** Required variables that must be provided at replay time */
  variables: string[];
  /** Starting URL */
  startUrl: string;
  /** Ordered list of steps */
  steps: WorkflowStep[];
  /** When this workflow was recorded */
  recordedAt: string;
  /** Version for schema evolution */
  version: number;
}

export interface ReplayOptions {
  /** Variable values to substitute */
  variables: Record<string, string>;
  /** Timeout per step (ms) */
  stepTimeout?: number;
  /** Whether to take screenshots between steps */
  screenshots?: boolean;
  /** Whether to stop on first error or continue */
  stopOnError?: boolean;
}

export interface ReplayResult {
  success: boolean;
  stepsCompleted: number;
  totalSteps: number;
  error?: string;
  screenshots?: string[];
}
