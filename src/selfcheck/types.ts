export type CheckStatus = 'pass' | 'fail' | 'warning';

export type FailureCategory = 'stale_code' | 'corrupt_data' | 'process_error' | 'config_error' | 'env_error';

export interface Diagnosis {
  category: FailureCategory;
  rootCause: string;
  suggestedFix: string;
}

export interface CheckResult {
  name: string;
  status: CheckStatus;
  score: number; // 0-100
  details: string[];
  fixable: boolean;
  fix?: () => Promise<string>; // returns fix description
  diagnosis?: Diagnosis; // structured diagnostic info when status !== 'pass'
}

export interface HealthCheck {
  name: string;
  description: string;
  run: () => Promise<CheckResult>;
}

export interface SelfcheckReport {
  timestamp: number;
  checks: CheckResult[];
  totalScore: number;
  hasFailed: boolean;
  hasWarning: boolean;
}
