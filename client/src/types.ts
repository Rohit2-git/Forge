// No role tiers in this build — every account has identical access. `Role`
// stays as a type (matching what the API still returns for `user.role`) but
// nothing in the UI branches on its value.
export type Role = 'admin' | 'qa_engineer' | 'qa_reviewer' | 'developer';

export interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
}

export interface Application {
  id: string;
  name: string;
  description: string;
  platform: 'web' | 'mobile' | 'api';
  url: string;
  createdAt: string;
  status: 'active' | 'inactive';
}

export interface TestCaseStep {
  id: string;
  instruction: string;
  expected: string;
}

export interface TestCase {
  id: string;
  appId: string;
  title: string;
  description: string;
  steps: TestCaseStep[];
  priority: 'low' | 'medium' | 'high';
  source?: 'manual' | 'ai-jira' | 'ai-acceptance';
  sourceReference?: string;
  section: string; // e.g. "Auth", "Checkout", "Profile"
  // Which of the 5 generation categories this test case belongs to — see
  // CATEGORY_CONFIG in server/app/services/llm_service.py. Optional/defaults
  // to 'functional' since manual/CSV-imported/pre-category-feature test
  // cases won't have one set.
  category?: 'functional' | 'regression' | 'data_driven' | 'smoke_e2e' | 'ui';
  featureArea?: string;
  createdAt: string;
}

export interface KnowledgeAsset {
  id: string;
  appId: string;
  name: string;
  type: 'doc' | 'link' | 'image' | 'pdf';
  summary: string;
  url?: string;
  tags: string[];
  createdAt: string;
}

export interface LogEntry {
  timestamp: string;
  type: 'info' | 'step' | 'success' | 'error' | 'warning';
  message: string;
}

export interface SimulationScreenshot {
  stepIndex: number;
  viewName: string;
  imageType: 'login' | 'dashboard' | 'search' | 'cart' | 'checkout' | 'payment_success' | 'profile' | 'settings' | 'error';
  highlightSelector?: string;
  highlightText?: string;
}

export interface ExecutionRun {
  id: string;
  appId: string;
  testCaseIds: string[];
  status: 'passed' | 'failed' | 'running';
  nlInstruction?: string;
  logs: LogEntry[];
  screenshots?: SimulationScreenshot[];
  metrics: {
    durationMs: number;
    stepsCount: number;
    passedCount: number;
  };
  executedAt: string;
}