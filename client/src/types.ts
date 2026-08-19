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

// ── Crawler Agent ──────────────────────────────────────────────────────
// One captured interactive element's full DOM detail — see
// server/app/executors/crawler.py's _ELEMENT_EXTRACTION_JS for the exact
// shape this mirrors.
export interface CrawledElement {
  tag: string;
  id: string | null;
  name: string | null;
  className: string | null;
  type: string | null;
  role: string | null;
  ariaLabel: string | null;
  placeholder: string | null;
  label: string;
  href: string | null;
  value: string | null;
  dataTestId: string | null;
  visible: boolean;
  selector: string;
  crawlId?: string;
}

export interface CrawlPage {
  id: string;
  sessionId: string;
  url: string;
  title: string | null;
  status: 'ok' | 'failed';
  errorMessage: string | null;
  screenshotPath: string | null;
  elementCount: number;
  elements?: CrawledElement[]; // present only on the full (non-list) fetch
  crawledAt: string;
  editedAt: string | null;
}

export interface CrawlSession {
  id: string;
  appId: string;
  baseUrl: string;
  status: 'running' | 'completed' | 'failed' | 'stopped';
  errorMessage: string | null;
  pagesCrawled: number;
  totalElements: number;
  authAttempted: boolean;
  authSucceeded: boolean;
  durationSec: number | null;
  createdAt: string;
  finishedAt: string | null;
  pages?: CrawlPage[];
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