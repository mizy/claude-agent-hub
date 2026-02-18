/**
 * @entry Selfcheck module - health assertion system
 */

import type { HealthCheck, SelfcheckReport } from './types.js';
import { dataIntegrityCheck } from './checks/dataIntegrity.js';
import { processHealthCheck } from './checks/processHealth.js';
import { envIsolationCheck } from './checks/envIsolation.js';
import { versionConsistencyCheck } from './checks/versionConsistency.js';
import { queueHealthCheck } from './checks/queueHealth.js';
import { configValidityCheck } from './checks/configValidity.js';
import { backendAvailabilityCheck } from './checks/backendAvailability.js';

export type { CheckStatus, CheckResult, HealthCheck, SelfcheckReport, FailureCategory, Diagnosis } from './types.js';

const allChecks: HealthCheck[] = [
  dataIntegrityCheck,
  processHealthCheck,
  envIsolationCheck,
  versionConsistencyCheck,
  queueHealthCheck,
  configValidityCheck,
  backendAvailabilityCheck,
];

export async function runSelfcheck(): Promise<SelfcheckReport> {
  const checks = await Promise.all(allChecks.map((c) => c.run()));

  const totalScore =
    checks.length > 0
      ? Math.round(checks.reduce((sum, c) => sum + c.score, 0) / checks.length)
      : 100;

  return {
    timestamp: Date.now(),
    checks,
    totalScore,
    hasFailed: checks.some((c) => c.status === 'fail'),
    hasWarning: checks.some((c) => c.status === 'warning'),
  };
}

export async function runFixes(report: SelfcheckReport): Promise<string[]> {
  const results: string[] = [];

  for (const check of report.checks) {
    if ((check.status === 'fail' || check.status === 'warning') && check.fixable && check.fix) {
      const description = await check.fix();
      results.push(`[${check.name}] ${description}`);
    }
  }

  return results;
}

/**
 * Generate a repair task for unfixable failures.
 *
 * Creates a CAH task with diagnosis context so an AI agent can investigate
 * and fix the issue. This is the core self-healing loop:
 *   selfcheck → diagnose → create repair task → agent fixes → re-verify
 *
 * Returns the created task, or null if no unfixable failures exist.
 */
export async function generateRepairTask(
  report: SelfcheckReport
): Promise<{ taskId: string; description: string } | null> {
  // Only target unfixable failures (fixable ones are handled by runFixes)
  const unfixable = report.checks.filter(
    (c) => c.status === 'fail' && !c.fixable && c.diagnosis
  );

  if (unfixable.length === 0) return null;

  // Build repair task description from diagnoses
  const lines = [
    'Selfcheck detected issues that require manual investigation:',
    '',
  ];

  for (const check of unfixable) {
    const d = check.diagnosis!;
    lines.push(`## ${check.name} (score: ${check.score}/100)`);
    lines.push(`- Category: ${d.category}`);
    lines.push(`- Root cause: ${d.rootCause}`);
    lines.push(`- Suggested fix: ${d.suggestedFix}`);
    for (const detail of check.details) {
      lines.push(`- Detail: ${detail}`);
    }
    lines.push('');
  }

  lines.push('After fixing, run `cah selfcheck` to verify the fix.');

  const description = lines.join('\n');

  // Lazy import to avoid circular dependency (task → selfcheck → task)
  const { createAndRunTask } = await import('../task/createAndRun.js');
  const task = await createAndRunTask({
    description,
    priority: 'high',
    autoRun: false, // Queue only, don't auto-run repair tasks
  });

  return { taskId: task.id, description };
}
