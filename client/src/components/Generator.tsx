import React, { useMemo, useRef, useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import {
  Ticket, ClipboardList, FileUp, Image, Sparkles, X,
  ChevronDown, ChevronRight, FileText, Trash2, Edit2, Terminal, CheckSquare, Square, Copy, Download, Activity, Cpu, Layers,
  RefreshCw, Settings2, MousePointerClick, AlertTriangle, Radar
} from 'lucide-react';
import { apiService } from '../services/api';

type GenerationMode = 'jira' | 'acceptance' | 'file' | 'wireframe' | 'crawler';

// Category split — mirrors CATEGORY_CONFIG in server/app/services/llm_service.py.
// Order here is display order (Functional first since it's the largest and the
// signal everything else scales from), not generation order.
const CATEGORY_META: Record<string, { label: string; color: string; bg: string; border: string }> = {
  functional:   { label: 'Functional',          color: '#1D6FB8', bg: 'rgba(56,189,248,0.12)', border: 'rgba(56,189,248,0.3)' },
  smoke_e2e:    { label: 'Smoke / End-to-End',   color: '#0F6B41', bg: 'rgba(74,222,128,0.14)', border: 'rgba(74,222,128,0.35)' },
  regression:   { label: 'Regression',           color: '#6E4CC9', bg: 'rgba(192,132,252,0.14)', border: 'rgba(192,132,252,0.3)' },
  data_driven:  { label: 'Data Driven',          color: '#8F5D08', bg: 'rgba(251,191,36,0.14)', border: 'rgba(251,191,36,0.5)' },
  ui:           { label: 'UI',                   color: '#B23A6B', bg: 'rgba(244,114,182,0.12)', border: 'rgba(244,114,182,0.3)' },
};
const CATEGORY_ORDER = ['functional', 'smoke_e2e', 'regression', 'data_driven', 'ui'];

interface StagedFile {
  id: string;
  file: File;
  type: 'file' | 'wireframe';
}

interface GeneratorLog {
  timestamp: string;
  type: 'info' | 'success' | 'warning' | 'step';
  message: string;
}

// Renders the Coverage Index tab: real scouted-workflow data compared against
// how many test cases actually exist for this app, plus a page-limit config
// field and a manual re-scan trigger. Kept as its own component since it has
// its own loading/error/empty states independent of the generation flow.
const CoverageIndexPanel: React.FC<{
  loading: boolean;
  error: string | null;
  profile: any;
  pageLimitInput: number;
  setPageLimitInput: (n: number) => void;
  onRescan: () => void;
}> = ({ loading, error, profile, pageLimitInput, setPageLimitInput, onRescan }) => {

  const intentLabels: Record<string, string> = {
    add_to_cart: 'Add to Cart', remove_from_cart: 'Remove from Cart', quantity_stepper: 'Quantity Stepper',
    checkout: 'Checkout', login: 'Login', signup: 'Sign Up', logout: 'Logout', search: 'Search',
    filter_sort: 'Filter / Sort', pagination: 'Pagination', upload: 'Upload', download_export: 'Download / Export',
    toggle: 'Toggle', delete: 'Delete', edit_update: 'Edit / Update', form_submit: 'Form Submit',
    nav_link: 'Navigation Link', generic_click: 'Generic Action',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#F3F4F7', border: '1px solid rgba(148,163,184,0.18)', borderRadius: '10px', padding: '0.85rem 1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Settings2 size={14} style={{ color: '#4C63D2' }} />
          <span style={{ fontSize: '0.78rem', color: '#4B4E5A', fontWeight: 600 }}>Crawl page limit</span>
          <input
            type="number"
            min={1}
            max={100}
            value={pageLimitInput}
            onChange={(e) => setPageLimitInput(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
            style={{ width: '64px', padding: '4px 6px', border: '1px solid rgba(148,163,184,0.22)', borderRadius: '6px', fontSize: '0.8rem' }}
          />
        </div>
        <button
          type="button"
          onClick={onRescan}
          disabled={loading}
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'rgba(129,140,248,0.12)', border: '1px solid rgba(129,140,248,0.4)', color: '#4C63D2', fontWeight: 700, fontSize: '0.78rem', borderRadius: '6px', padding: '0.4rem 0.75rem', cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.6 : 1 }}
        >
          <RefreshCw size={13} className={loading ? 'spin' : ''} /> {loading ? 'Scanning…' : 'Re-scan Application'}
        </button>
      </div>

      {loading && !profile && (
        <div style={{ padding: '2rem', textAlign: 'center', color: '#6B7280', fontSize: '0.85rem' }}>
          Scouting the live application — crawling pages and classifying interactive elements…
        </div>
      )}

      {error && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.35)', color: '#C7402B', padding: '0.85rem 1rem', borderRadius: '10px', fontSize: '0.8rem' }}>
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: '1px' }} />
          <span>{error}</span>
        </div>
      )}

      {profile && !loading && (
        <>
          {profile.authAttempted && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 0.85rem', borderRadius: '8px', fontSize: '0.78rem',
              background: profile.authSucceeded ? 'rgba(74,222,128,0.12)' : 'rgba(251,191,36,0.12)',
              border: `1px solid ${profile.authSucceeded ? 'rgba(74,222,128,0.35)' : 'rgba(251,191,36,0.5)'}`,
              color: profile.authSucceeded ? '#157F52' : '#8F5D08',
            }}>
              {profile.authSucceeded
                ? '✓ Detected a login wall and signed in with this app\'s Test Data before crawling — results reflect the authenticated app.'
                : '⚠ Detected a login wall but could not sign in (no matching Test Data, or the credentials didn\'t work) — results only reflect the login page itself. Add a Test Data Template/Condition for this app and re-scan.'}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
            <div style={{ background: '#F3F4F7', border: '1px solid rgba(148,163,184,0.18)', borderRadius: '10px', padding: '1rem' }}>
              <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Coverage Index</span>
              <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#14151A', marginTop: '2px' }}>{profile.coveragePercent}%</div>
              <div style={{ fontSize: '0.72rem', color: '#6B7280', marginTop: '2px' }}>{profile.generatedTestCases} of ~{profile.estimatedTestCases} estimated workflows covered</div>
            </div>
            <div style={{ background: '#F3F4F7', border: '1px solid rgba(148,163,184,0.18)', borderRadius: '10px', padding: '1rem' }}>
              <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Pages Scanned</span>
              <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#14151A', marginTop: '2px' }}>{profile.pagesScanned}</div>
              <div style={{ fontSize: '0.72rem', color: '#6B7280', marginTop: '2px' }}>{profile.totalElements} interactive elements found</div>
            </div>
            <div style={{ background: '#F3F4F7', border: '1px solid rgba(148,163,184,0.18)', borderRadius: '10px', padding: '1rem' }}>
              <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Safe to Generate</span>
              <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#14151A', marginTop: '2px' }}>+{profile.safeToGenerateMore}</div>
              <div style={{ fontSize: '0.72rem', color: '#6B7280', marginTop: '2px' }}>more before redundancy risk</div>
            </div>
          </div>

          <div style={{ background: '#F3F4F7', border: '1px solid rgba(148,163,184,0.18)', borderRadius: '10px', padding: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#6B7280' }}>Generated vs. Estimated Workflows</span>
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#4B4E5A' }}>{profile.generatedTestCases} / {profile.estimatedTestCases}</span>
            </div>
            <div style={{ width: '100%', height: '10px', background: 'rgba(148,163,184,0.18)', borderRadius: '999px', overflow: 'hidden' }}>
              <div style={{ width: `${Math.min(100, profile.coveragePercent)}%`, height: '100%', background: profile.coveragePercent >= 100 ? '#B4790A' : '#4C63D2', borderRadius: '999px', transition: 'width 0.3s ease' }} />
            </div>
          </div>

          <div style={{ background: '#F3F4F7', border: '1px solid rgba(148,163,184,0.18)', borderRadius: '10px', padding: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.75rem' }}>
              <MousePointerClick size={14} style={{ color: '#4C63D2' }} />
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Discovered Workflows ({profile.workflows.length})</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: '220px', overflowY: 'auto' }}>
              {profile.workflows.length === 0 && (
                <span style={{ fontSize: '0.78rem', color: '#6B7280' }}>No actionable workflows discovered — check the crawl page limit or the app URL.</span>
              )}
              {profile.workflows.map((w: any, i: number) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.4rem 0.6rem', background: '#FFFFFF', border: '1px solid #E7E9EE', borderRadius: '6px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#14151A' }}>{intentLabels[w.intent] || w.intent}</span>
                    <span style={{ fontSize: '0.68rem', color: '#6B7280', fontFamily: 'monospace' }}>{w.routePattern} · {w.instanceCount} instance(s) clustered</span>
                  </div>
                  <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#4C63D2', background: 'rgba(129,140,248,0.12)', padding: '2px 8px', borderRadius: '4px' }}>{w.variants} variant(s)</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export const Generator: React.FC = () => {
  const {
    applications, activeAppId, refreshTestCases, generationBatches, setGenerationBatches,
    setIsGenerationRunning,
    generatorFormState, setGeneratorFormState
  } = useApp();

  const [mode, setMode] = useState<GenerationMode>((generatorFormState.mode as GenerationMode) || 'jira');
  const [sourceInput, setSourceInput] = useState(generatorFormState.sourceInput || '');
  // Optional user-chosen label for this batch (e.g. "Checkout Flow"). Left
  // empty by default — if the user doesn't provide one, the original
  // uploaded filename is used as the display label instead (handled server-side).
  const [batchName, setBatchName] = useState(generatorFormState.batchName || '');
  const [appContextInput, setAppContextInput] = useState('');
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  // Test case count is no longer user-chosen — the AI decides how many test
  // cases a given input needs (see triggerGeneration / the backend's
  // MIN_BLUEPRINTS/MAX_BLUEPRINTS guardrails in llm_service.py).

  // Data source override — lets the user explicitly pick a Data Template,
  // Synthetic Condition, or Bulk Batch for this run instead of relying on
  // the backend's automatic per-test-case template matching (which gets
  // expensive/unreliable once templates and batches pile up). Value format:
  // "" = Auto, or "{mode}:{id}" e.g. "batch:abc123".
  const [dataSourceSelection, setDataSourceSelection] = useState<string>('');
  const [dataSourceTemplates, setDataSourceTemplates] = useState<any[]>([]);
  const [dataSourceConditions, setDataSourceConditions] = useState<any[]>([]);
  const [dataSourceBatches, setDataSourceBatches] = useState<any[]>([]);

  // Crawler Data mode — lets a completed Crawler Agent run (id/class/name/
  // selector inventory + screenshots, see CrawlerAgent.tsx) stand in as the
  // generation source instead of a Jira story or uploaded file. Selecting
  // pages here builds a plain-text element inventory straight into
  // `sourceInput`, so it flows through the exact same generateTestPack(...)
  // call every other mode already uses — no backend changes needed.
  const [crawlSession, setCrawlSession] = useState<any>(null);
  const [crawlLoading, setCrawlLoading] = useState(false);
  const [crawlError, setCrawlError] = useState<string | null>(null);
  const [selectedCrawlPageIds, setSelectedCrawlPageIds] = useState<string[]>([]);

  const formatCrawlPagesAsText = (pages: any[]): string => {
    return pages.map((p: any) => {
      const elLines = (p.elements || []).map((el: any) => {
        const bits = [
          el.tag,
          el.id ? `id="${el.id}"` : null,
          el.name ? `name="${el.name}"` : null,
          el.className ? `class="${el.className}"` : null,
          el.role ? `role="${el.role}"` : null,
          el.type ? `type="${el.type}"` : null,
          el.label ? `label="${el.label}"` : null,
          el.dataTestId ? `data-testid="${el.dataTestId}"` : null,
          el.href ? `href="${el.href}"` : null,
          `selector="${el.selector}"`,
        ].filter(Boolean).join(' ');
        return `  - ${bits}`;
      }).join('\n');
      return `PAGE: ${p.title || 'Untitled'} (${p.url})\nElements:\n${elLines || '  (none captured)'}`;
    }).join('\n\n');
  };

  // Load the latest crawl session for the active app whenever Crawler Data
  // mode is selected.
  useEffect(() => {
    if (mode !== 'crawler' || !activeAppId) return;
    (async () => {
      setCrawlLoading(true);
      setCrawlError(null);
      try {
        const list = await apiService.listCrawlSessions(activeAppId);
        if (!list || list.length === 0) {
          setCrawlSession(null);
          setSelectedCrawlPageIds([]);
          return;
        }
        const latest = list[0];
        const full = await apiService.getCrawlSession(activeAppId, latest.id);
        setCrawlSession(full);
        const okPageIds = (full.pages || []).filter((p: any) => p.status === 'ok').map((p: any) => p.id);
        setSelectedCrawlPageIds(okPageIds);
      } catch (err: any) {
        setCrawlError(err.message || 'Failed to load crawl data.');
      } finally {
        setCrawlLoading(false);
      }
    })();
  }, [mode, activeAppId]);

  // Whenever the page selection changes, fetch full element detail for the
  // selected pages (the session/list endpoints intentionally return "light"
  // pages without element JSON to keep the gallery fast — see
  // _serialize_page_light in crawler.py) and rebuild sourceInput from them.
  useEffect(() => {
    if (mode !== 'crawler' || !crawlSession || !activeAppId) return;
    if (selectedCrawlPageIds.length === 0) {
      setSourceInput('');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const fullPages = await Promise.all(
          selectedCrawlPageIds.map((id) => apiService.getCrawlPage(activeAppId, id))
        );
        if (!cancelled) setSourceInput(formatCrawlPagesAsText(fullPages));
      } catch (err: any) {
        if (!cancelled) setCrawlError(err.message || 'Failed to load selected pages\' elements.');
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCrawlPageIds, crawlSession, mode, activeAppId]);

  const toggleCrawlPage = (pageId: string) => {
    setSelectedCrawlPageIds(prev => prev.includes(pageId) ? prev.filter(id => id !== pageId) : [...prev, pageId]);
  };

  // Persist form state to AppContext whenever key fields change
  useEffect(() => {
    setGeneratorFormState(prev => ({ ...prev, mode, sourceInput, batchName }));
  }, [mode, sourceInput, batchName]);

  // One-time cleanup: remove legacy batches that have no appId (from before appId tracking)
  useEffect(() => {
    setGenerationBatches(prev => prev.filter((b: any) => !!b.appId));
  }, []);

  // Load available data sources (templates, conditions, bulk batches) for the
  // data-source picker whenever the active app changes. Reset the selection
  // too, since a source id from one app is meaningless for another.
  useEffect(() => {
    setDataSourceSelection('');
    if (!activeAppId) {
      setDataSourceTemplates([]);
      setDataSourceConditions([]);
      setDataSourceBatches([]);
      return;
    }
    (async () => {
      try {
        const [t, c, b] = await Promise.all([
          apiService.listTestDataTemplates(activeAppId),
          apiService.listTestDataConditions(activeAppId),
          apiService.listSyntheticBatches(activeAppId),
        ]);
        setDataSourceTemplates(t || []);
        setDataSourceConditions(c || []);
        setDataSourceBatches(b || []);
      } catch (err) {
        console.error('Failed to load data sources for picker:', err);
      }
    })();
  }, [activeAppId]);

  // Reset staged inputs (uploaded files/screenshots + pasted text) whenever the
  // active app changes. Without this, switching apps mid-session left the
  // previous app's stagedFiles/sourceInput sitting in state — since the only
  // other place these get cleared is the post-generation success handler, not
  // an app switch — so the next generate call for the NEW app silently bundled
  // in the OLD app's screenshots/text, producing test cases mixing both apps.
  useEffect(() => {
    setStagedFiles([]);
    setSourceInput('');
  }, [activeAppId]);

  const [isGenerating, setIsGenerating] = useState(false);
  const [generationElapsedSec, setGenerationElapsedSec] = useState<number | null>(null);
  const [showModal, setShowModal] = useState(false);

  const [modalLogs, setModalLogs] = useState<GeneratorLog[]>([]);
  const [activeBatchMetrics, setActiveBatchMetrics] = useState<any>(null);
  const [activeBatchTitle, setActiveBatchTitle] = useState<string>('');

  // Coverage Index is now a standalone feature (its own button + modal in the
  // studio header), separate from the generation Execution Trace modal, since
  // it's per-app data rather than per-batch.
  const [showCoverageModal, setShowCoverageModal] = useState(false);
  const [scoutProfile, setScoutProfile] = useState<any>(null);
  const [scoutLoading, setScoutLoading] = useState(false);
  const [scoutError, setScoutError] = useState<string | null>(null);
  const [scoutPageLimitInput, setScoutPageLimitInput] = useState<number>(15);
  const scoutCacheRef = useRef<Record<string, any>>({});

  const [activeExportDropdownId, setActiveExportDropdownId] = useState<string | null>(null);

  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([]);
  // Which category tab is active per batch — "all" (default) or a
  // CATEGORY_ORDER key. Drives both the horizontal tab bar and which
  // section(s) of a batch's test cases are rendered below it.
  const [activeCategoryTab, setActiveCategoryTab] = useState<Record<string, string>>({});
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const consoleBottomRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const activeApp = applications.find((app) => app.id === activeAppId);

  const modeConfig = {
    jira: { placeholder: "Paste Jira Story Link or Ticket Body descriptions here... (Compulsory if no files attached)", accept: "" },
    acceptance: { placeholder: "Enter explicit acceptance criteria rules here... (Compulsory if no files attached)", accept: "" },
    file: { placeholder: "Optional guidelines for this User Story file...", accept: ".pdf,.txt,.docx,.md" },
    wireframe: { placeholder: "Optional click logic for this Wireframe capture...", accept: ".png,.jpg,.jpeg,.webp" },
    crawler: { placeholder: "Select crawled pages on the right — their captured elements populate this box automatically. Edit freely before generating.", accept: "" }
  };

  const isFormValid = useMemo(() => {
    return sourceInput.trim().length > 0 || stagedFiles.some(f => f.type === 'file' || f.type === 'wireframe');
  }, [sourceInput, stagedFiles]);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setActiveExportDropdownId(null);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  useEffect(() => {
    if (consoleBottomRef.current) {
      consoleBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [modalLogs, showModal]);

  const handleModeChange = (newMode: GenerationMode) => {
    setMode(newMode);
    if (['file', 'wireframe'].includes(newMode)) {
      setTimeout(() => fileInputRef.current?.click(), 10);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const newStagedFiles: StagedFile[] = files.map(file => ({
      id: `file-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      file,
      type: mode as 'file' | 'wireframe'
    }));
    setStagedFiles(prev => [...prev, ...newStagedFiles]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Holds the AbortController for whichever generation request is currently in flight,
  // so Stop Generation can actually cancel the fetch instead of just resetting UI state.
  const abortControllerRef = React.useRef<AbortController | null>(null);

  const handleReopenModalForBatch = (batch: any) => {
    setModalLogs(batch.logs || []);
    setActiveBatchMetrics(batch.metrics || null);
    setActiveBatchTitle(batch.batchName || batch.sourceLabel || batch.metrics?.sourceFileName || '');
    // Restore THIS batch's own generation time instead of leaving whatever the
    // last-run global value was — each batch carries its own stamped duration now.
    setGenerationElapsedSec(batch.metrics?.generationTime ?? null);
    setShowModal(true);
  };

  const fetchScoutProfile = async (force = false) => {
    if (!activeAppId) return;
    if (!force && scoutCacheRef.current[activeAppId]) {
      setScoutProfile(scoutCacheRef.current[activeAppId]);
      return;
    }
    setScoutLoading(true);
    setScoutError(null);
    try {
      const profile = await apiService.getScoutProfile(activeAppId);
      scoutCacheRef.current[activeAppId] = profile;
      setScoutProfile(profile);
      setScoutPageLimitInput(profile.pageLimit ?? 15);
    } catch (err: any) {
      setScoutError(err.message || 'Failed to scout the application.');
    } finally {
      setScoutLoading(false);
    }
  };

  const handleRescanApplication = async () => {
    if (!activeAppId) return;
    setScoutLoading(true);
    setScoutError(null);
    try {
      const profile = await apiService.refreshScoutProfile(activeAppId, scoutPageLimitInput);
      scoutCacheRef.current[activeAppId] = profile;
      setScoutProfile(profile);
    } catch (err: any) {
      setScoutError(err.message || 'Re-scan failed.');
    } finally {
      setScoutLoading(false);
    }
  };

  // Lazy-load coverage data only when the standalone Coverage Index modal is
  // actually opened, and only once per app (cached in scoutCacheRef) unless
  // the user hits Re-scan.
  useEffect(() => {
    if (showCoverageModal && activeAppId) {
      fetchScoutProfile(false);
    }
  }, [showCoverageModal, activeAppId]);

  // Appends a single timestamped line to the generation console modal.
  // Centralizes the pattern already used inline elsewhere in this file
  // (see the catch block in triggerGeneration) so callers like
  // handleStopGeneration don't need to repeat the timestamp formatting.
  const pushModalLog = (type: GeneratorLog['type'], message: string) => {
    setModalLogs(prev => [...prev, { timestamp: new Date().toTimeString().split(' ')[0], type, message }]);
  };

  const handleStopGeneration = async () => {
    // This is the actual fix: abort the real in-flight fetch, not just flip local state.
    // Without this call, the backend keeps working and the result lands a minute later
    // regardless of what the UI says.
    abortControllerRef.current?.abort();
    // Clean up: remove the in-progress batch from generationBatches
    setGenerationBatches((prev: any[]) => prev.filter((b: any) => !b.inProgress));
    setIsGenerating(false);
    setIsGenerationRunning(false);
    pushModalLog('warning', 'Generation stopped by user. Partial data cleared.');
    setTimeout(() => setShowModal(false), 1500);
  };

  const triggerGeneration = async () => {
    if (!activeAppId || !isFormValid) return;

    const newBatchId = `batch-${Date.now()}`;
    const capturedAppId = activeAppId; // capture now to prevent closure mismatch
    // Fresh controller per run — Stop Generation calls .abort() on whichever one is current.
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setShowModal(true);
    setIsGenerating(true);
    // ⚡ SWITCH THE STATUS GLOW AND FOOTER CHIP IMMEDIATELY TO RED COMPILING MODE
    setIsGenerationRunning(true);
    setActiveBatchMetrics(null);
    // Clear any stale time from a previously-viewed batch so the live run
    // doesn't briefly flash an old duration before its own timer lands.
    setGenerationElapsedSec(null);

    // Only two things are actually knowable before the request goes out —
    // that generation started, and against which app. Everything after this
    // (which pass ran, how many tokens, whether the top-up fired) gets pushed
    // in AFTER the response arrives, built from the real generation_trace the
    // backend returns — not guessed at up front.
    const initialLogs: GeneratorLog[] = [
      { timestamp: new Date().toTimeString().split(' ')[0], type: 'info', message: 'Generation request sent to backend.' },
      { timestamp: new Date().toTimeString().split(' ')[0], type: 'info', message: `Target application: "${activeApp?.name || 'Unknown'}"` }
    ];
    setModalLogs(initialLogs);

    let sourceLabel = stagedFiles.length > 0
      ? stagedFiles.map(f => f.file.name).join(' + ')
      : (mode === 'jira' ? 'Jira Specification Context' : 'Acceptance Criteria Text');

    setActiveBatchTitle(batchName.trim() || sourceLabel);

    const _genStart = Date.now();
    try {
      let responseData;
      let compilationFilesList = [...stagedFiles];
      if (appContextInput.trim().length > 0) {
        const contextBlob = new Blob([appContextInput], { type: 'text/plain' });
        compilationFilesList.push({
          id: 'integrated-context',
          file: new File([contextBlob], 'context_rules.txt'),
          type: 'context' as any
        });
      }

      initialLogs.push({
        timestamp: new Date().toTimeString().split(' ')[0],
        type: 'step',
        message: 'Pass 1/2 in progress — blueprint discovery and step expansion running against Gemini.'
      });
      setModalLogs([...initialLogs]);

      // Parse "mode:id" selection into the two params the backend expects.
      const [selectedMode, selectedId] = dataSourceSelection
        ? (dataSourceSelection.split(':') as ['template' | 'condition' | 'batch', string])
        : [undefined, undefined];

      // Cross-batch dedup: titles of every test case already sitting in THIS
      // app's other staging batches this session (not yet saved to the repo —
      // the backend separately pulls already-saved titles from the DB). Sent
      // along so Pass 1 doesn't regenerate the same login/checkout scenarios
      // batch after batch.
      const existingTitlesForApp = generationBatches
        .filter((b: any) => b.appId === activeAppId)
        .flatMap((b: any) => b.testCases.map((tc: any) => tc.title))
        .filter(Boolean);

      if (compilationFilesList.length > 0) {
        responseData = await apiService.generateTestPackFromFiles(compilationFilesList as any, activeAppId, controller.signal, selectedMode, selectedId, existingTitlesForApp);
      } else {
        responseData = await apiService.generateTestPack(sourceInput, activeAppId, controller.signal, selectedMode, selectedId, existingTitlesForApp);
      }

      // controller.abort() only rejects the fetch promise if the request was still in
      // flight at the moment of the call. If the response had already fully arrived
      // (e.g. the user waited long enough that generation actually finished just before
      // clicking Stop), abort() is a no-op and this await resolves normally with real
      // data — no AbortError is ever thrown. Without this check, that race lets a
      // "stopped" generation still render as a completed batch. Since nothing in the
      // backend writes to the DB during /tests/generate anymore (only /tests/save does),
      // this is purely about not showing the result in the UI — discarding it here is safe.
      if (controller.signal.aborted) {
        throw new DOMException('Generation result discarded after stop.', 'AbortError');
      }

      // Display label for this batch: user's chosen Batch Name if provided,
      // otherwise the source file/input label — mirrors the same fallback
      // logic the backend applies when persisting to the DB.
      const effectiveBatchLabel = batchName.trim() || sourceLabel;

      const mappedTests = responseData.test_cases.map((tc: any, index: number) => {
        const parsedSteps = typeof tc.steps === 'string' ? JSON.parse(tc.steps) : tc.steps;
        return {
          id: `gen-${Date.now()}-${index}-${Math.floor(Math.random() * 10000)}`,
          appId: capturedAppId,
          title: tc.title || tc.scenario_name || 'Untitled Test Scenario',
          description: tc.expected_result || '',
          priority: tc.type === 'edge_case' ? 'medium' : 'high',
          section: effectiveBatchLabel,
          source: 'ai',
          type: tc.type || 'positive',
          // Category split (functional / regression / data_driven / smoke_e2e /
          // ui) — see CATEGORY_CONFIG in llm_service.py. Defaults to
          // 'functional' for any response that predates this field.
          category: tc.category || 'functional',
          featureArea: tc.feature_area || 'Uncategorized',
          steps: parsedSteps.map((stepStr: string, idx: number) => ({
            id: `step-${Date.now()}-${idx}`,
            instruction: stepStr,
            expected: idx === parsedSteps.length - 1 ? (tc.expected_result || 'Condition met.') : 'Step passed.'
          }))
        };
      });

      // Real taxonomy from the backend: every test case is tagged exactly
      // "positive", "negative", or "edge_case" (see llm_service.py's
      // BlueprintListSchema) — no fabricated "security exception" category.
      const happyPaths = mappedTests.filter((t: any) => t.type === 'positive').length;
      const edgeCases = mappedTests.filter((t: any) => t.type === 'edge_case').length;
      const negativeFlows = mappedTests.filter((t: any) => t.type === 'negative').length;

      // Stamp this run's elapsed time once, here, and carry it inside the batch's own
      // metrics object — not a separate piece of shared state — so every batch keeps
      // its own true duration permanently, even after the next generation runs.
      const elapsedSec = Math.round((Date.now() - _genStart) / 1000);
      const trace = responseData.generation_trace || null;
      const computedMetrics = {
        happyPaths,
        edgeCases,
        negativeFlows,
        sourceFileName: sourceLabel.split(' + ')[0],
        generationTime: elapsedSec,
        generationTrace: trace,
      };

      // Real trace log lines, built from the actual Gemini calls the backend
      // made for this batch_label — model, tokens, and whether the Pass 1
      // top-up retry fired — instead of fabricated "kernel telemetry" copy.
      const traceLogs: GeneratorLog[] = [];
      if (trace) {
        traceLogs.push({
          timestamp: new Date().toTimeString().split(' ')[0], type: 'step',
          message: `Pass 1 (blueprint discovery) completed in ${trace.pass1_time_sec}s — ${trace.pass1_input_tokens + trace.topup_input_tokens} input / ${trace.pass1_output_tokens + trace.topup_output_tokens} output tokens.`
        });
        if (trace.topup_fired) {
          traceLogs.push({
            timestamp: new Date().toTimeString().split(' ')[0], type: 'warning',
            message: `AI decided on fewer than ${trace.min_bound} blueprints — top-up retry call fired to reach the floor.`
          });
        }
        if (trace.ai_decided_count != null) {
          const featureCount = trace.feature_breakdown ? Object.keys(trace.feature_breakdown).length : 0;
          traceLogs.push({
            timestamp: new Date().toTimeString().split(' ')[0], type: 'info',
            message: `AI decided ${trace.ai_decided_count} test case(s) were appropriate, across ${featureCount} feature area(s).`
          });
        }
        traceLogs.push({
          timestamp: new Date().toTimeString().split(' ')[0], type: 'step',
          message: `Pass 2 (step expansion) completed in ${trace.pass2_time_sec}s across ${trace.pass2_call_count} Gemini call(s) — ${trace.pass2_input_tokens} input / ${trace.pass2_output_tokens} output tokens.`
        });
      }

      // Append success final lines safely
      const completedLogs: GeneratorLog[] = [
        ...initialLogs,
        ...traceLogs,
        { timestamp: new Date().toTimeString().split(' ')[0], type: 'success', message: `Generation complete — ${mappedTests.length} test case(s) produced in ${elapsedSec}s.` }
      ];
      setGenerationElapsedSec(elapsedSec);
      setModalLogs(completedLogs);
      setActiveBatchMetrics(computedMetrics);

      setGenerationBatches(prev => [...prev, {
        id: newBatchId,
        appId: capturedAppId,
        sourceLabel,
        batchName: effectiveBatchLabel,
        testCases: mappedTests,
        isCollapsed: false,
        logs: completedLogs,
        metrics: computedMetrics
      }]);

      setStagedFiles([]);
      setSourceInput('');
    } catch (e: any) {
      if (e.name === 'AbortError') {
        // Expected path when the user clicks Stop Generation — handleStopGeneration
        // already pushed its own warning log and reset state, so there's nothing
        // further to do here. Specifically: don't log this as an engine exception,
        // and don't fall through to append a batch below.
      } else {
        // Surface rate-limit errors (429) with the backend's message which includes
        // time remaining — e.g. "Generation limit reached (5 per 10 min). Try again in 4m 30s."
        const isRateLimit = e.message?.includes('limit reached') || e.message?.includes('limit reached') || e.message?.includes('Try again in');
        const logType = isRateLimit ? 'warning' : 'warning';
        const logMsg = isRateLimit
          ? `⏱ Rate Limit: ${e.message}`
          : `Engine Exception Fired: ${e.message}`;
        setModalLogs(prev => [...prev, { timestamp: new Date().toTimeString().split(' ')[0], type: logType, message: logMsg }]);
      }
    } finally {
      setIsGenerating(false);
      // ⚡ DISENGAGE COMPILING STATE; SIDEBAR IMMEDIATELY RETURNS GREEN AND SAYS IDLE
      setIsGenerationRunning(false);
      // Clear the ref only if it's still pointing at this run's controller — avoids
      // a late-finishing older run accidentally clobbering a newer run's controller.
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
    }
  };

  const handleCardSelectionToggle = (id: string) => {
    setSelectedCardIds(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]);
  };

  const handleToggleSelectAllBatch = (batchTestCases: any[]) => {
    const allIds = batchTestCases.map(t => t.id);
    const areAllSelected = allIds.every(id => selectedCardIds.includes(id));
    setSelectedCardIds(prev => areAllSelected ? prev.filter(id => !allIds.includes(id)) : [...new Set([...prev, ...allIds])]);
  };

  const handleBulkDeleteFromBatch = (batchId: string, batchTestCases: any[]) => {
    const targets = batchTestCases.filter(tc => selectedCardIds.includes(tc.id));
    if (!targets.length) return;
    if (confirm(`Purge all ${targets.length} selected test cases out of this staging batch?`)) {
      setGenerationBatches(prev => prev.map(batch => {
        if (batch.id !== batchId) return batch;
        return { ...batch, testCases: batch.testCases.filter((tc: any) => !selectedCardIds.includes(tc.id)) };
      }).filter(batch => batch.testCases.length > 0));
      setSelectedCardIds(prev => prev.filter(id => !targets.some(t => t.id === id)));
    }
  };

  // Tracks which batch is currently saving — not a shared boolean — so only
  // that one batch's button shows "Saving..." while others stay clickable.
  const [savingBatchId, setSavingBatchId] = useState<string | null>(null);

  const handleSaveSelectedToRepo = async (batchId: string, batchTestCases: any[], explicitIds?: string[]) => {
    const idsToSave = explicitIds ?? selectedCardIds;
    const targets = batchTestCases.filter(tc => idsToSave.includes(tc.id));
    if (!targets.length) return;

    const batch = generationBatches.find((b: any) => b.id === batchId);

    // The backend's /tests/save expects expected_result as a flat string per
    // test case and steps as plain instruction strings — not the nested
    // {id, instruction, expected} step objects this component uses for
    // in-card editing. Reshape before sending.
    const payloadTestCases = targets.map(tc => ({
      title: tc.title,
      steps: (tc.steps || []).map((s: any) => s.instruction),
      expected_result: tc.steps?.length ? tc.steps[tc.steps.length - 1].expected : 'Condition met.',
      // BUG FIX: this used to derive `type` from `priority` (tc.priority ===
      // 'medium' ? 'edge_case' : 'functional') instead of using the real
      // positive/negative/edge_case value already sitting on tc.type — that
      // meant every saved test case's real type/negative-vs-positive
      // distinction was lost, AND it stamped a category name ("functional")
      // into the type column, which made no sense even before category
      // existed as its own concept. Use the actual fields.
      type: tc.type || 'positive',
      category: tc.category || 'functional',
      feature_area: tc.featureArea || 'Uncategorized',
      test_data_source_type: tc.test_data_source_type ?? null,
      test_data_source_id: tc.test_data_source_id ?? null,
      test_data_values: tc.test_data_values ?? null,
    }));

    setSavingBatchId(batchId);
    try {
      // This used to only call addTestCase() below, which just appends to
      // local React/localStorage state — it never sent a network request at
      // all, so nothing reached the database, no createdByUserId/visibility
      // was ever stamped, and "Save All to Repo" looked successful (the card
      // appeared in this admin's own Repository view, since that view reads
      // the same local state) while every other role still saw nothing.
      await apiService.saveTestCasesToRepo({
        filename: batch?.sourceLabel || 'Generated Tests',
        batch_name: batch?.batchName,
        app_id: batch?.appId,
        test_cases: payloadTestCases,
      });

      // NOTE: this used to also call addTestCase() here to optimistically
      // mirror the save into local state. Now that the backend save call
      // above actually persists for real, that local write became a second,
      // undeduplicated copy: AppContext's periodic fetchFromDB() pulls the
      // same test cases back from the DB shortly after, so the SAME account
      // that generated them ended up seeing every batch twice — once from
      // this local optimistic write (with the correct section/focus area),
      // once from the DB fetch (previously with a filename-derived section,
      // now fixed to use the persisted `section` column instead). Removed
      // entirely; the DB is the single source of truth post-save.
      // Refresh AppContext so Repository.tsx shows the newly saved cases immediately
      // without requiring a page reload. Previously fetchFromDB only ran on mount
      // so the Test Cases section stayed empty until the user refreshed the browser.
      await refreshTestCases();
      alert(`Successfully saved ${targets.length} selected cases to your active repository!`);
      setSelectedCardIds(prev => prev.filter(id => !targets.some(t => t.id === id)));
    } catch (e: any) {
      alert(e?.message || 'Failed to save test cases to the repository. Please try again.');
    } finally {
      setSavingBatchId(null);
    }
  };

  const openInlineEdit = (id: string, currentTitle: string) => {
    setEditingCardId(id);
    setEditTitle(currentTitle);
  };

  const saveInlineEdit = (batchId: string) => {
    setGenerationBatches(prev => prev.map(batch => {
      if (batch.id !== batchId) return batch;
      return { ...batch, testCases: batch.testCases.map((tc: any) => tc.id === editingCardId ? { ...tc, title: editTitle } : tc) };
    }));
    setEditingCardId(null);
  };

  // Wraps a field in quotes and escapes embedded quotes per RFC 4180, only
  // when the field actually needs it (contains a comma, quote, or newline) —
  // keeps plain fields readable while still round-tripping safely in Excel/
  // Sheets/etc. for anything with commas or multi-line step lists.
  const csvEscape = (value: string): string => {
    const str = String(value ?? '');
    if (/[",\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const executeDirectExport = (testCases: any[], format: 'txt' | 'json' | 'csv') => {
    let content = '';
    let mimeType = 'text/plain;charset=utf-8';
    if (format === 'json') {
      content = JSON.stringify(testCases, null, 2);
      mimeType = 'application/json';
    } else if (format === 'csv') {
      // Matches the team's existing test-case sheet layout exactly (SL No /
      // Test scenarios / Steps / Expected results — see the reference
      // "Transaction Details Stepper" sheet), not an OmniTestAI-invented
      // shape, so exports drop straight into the format the team already
      // works with.
      const header = ['SL No', 'Test scenarios', 'Steps', 'Expected results'];
      const rows = testCases.map((t, idx) => {
        const stepsJoined = (t.steps || [])
          .map((s: any, sIdx: number) => `${sIdx + 1}. ${s.instruction}`)
          .join('\n');
        const expectedResult = t.description || (t.steps?.length ? t.steps[t.steps.length - 1]?.expected : '') || '';
        return [
          String(idx + 1),
          t.title || 'Untitled Test Case',
          stepsJoined,
          expectedResult
        ];
      });
      content = [header, ...rows].map(row => row.map(csvEscape).join(',')).join('\r\n');
      // BOM so Excel opens UTF-8 content (special chars in steps/titles) correctly.
      content = '\uFEFF' + content;
      mimeType = 'text/csv;charset=utf-8';
    } else {
      content = testCases.map((t, idx) => `TEST SCENARIO ${idx + 1}: ${t.title}\nSTEPS:\n${t.steps.map((s: any, sIdx: number) => `  ${sIdx + 1}. ${s.instruction} -> Assert: ${s.expected}`).join('\n')}`).join('\n\n');
    }
    const blob = new Blob([content], { type: mimeType });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `OmniTestAI_Export_${Date.now()}.${format}`;
    link.click();
    setActiveExportDropdownId(null);
  };

  const executeDirectCopy = (testCases: any[]) => {
    const cleanText = testCases.map((t, idx) => `${idx + 1}. ${t.title}\nSteps:\n${t.steps.map((s: any) => `  - ${s.instruction} → ${s.expected}`).join('\n')}`).join('\n\n');
    navigator.clipboard.writeText(cleanText);
    alert('Full batch structure layout copied cleanly to clipboard storage.');
  };

  return (
    <div className="generator-view" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '1200px', margin: '0 auto', fontFamily: 'var(--font-sans)' }}>
      <div className="view-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#14151A', letterSpacing: '-0.02em' }}>AI Test Design Studio</h1>
          <p style={{ color: '#6B7280', marginTop: '0.25rem', fontSize: '0.95rem' }}>Generate scalable test packs from requirements while grounding outputs on specific application operational context parameters.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowCoverageModal(true)}
          disabled={!activeAppId}
          title={!activeAppId ? 'Select an application first' : 'View Coverage Index for this application'}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.4rem', flexShrink: 0, marginTop: '0.2rem',
            background: 'rgba(129,140,248,0.12)', border: '1px solid rgba(129,140,248,0.4)', color: '#4C63D2', fontWeight: 700, fontSize: '0.85rem',
            borderRadius: '8px', padding: '0.55rem 0.9rem', cursor: activeAppId ? 'pointer' : 'not-allowed',
            opacity: activeAppId ? 1 : 0.5
          }}
        >
          <Activity size={15} /> Coverage Index
        </button>
      </div>

      <div className="glass-card" style={{ background: '#FFFFFF', border: '1px solid rgba(148,163,184,0.16)', borderRadius: '12px', padding: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
          <button type="button" className={`btn btn-secondary btn-small ${mode === 'jira' ? 'active-app-border' : ''}`} onClick={() => handleModeChange('jira')} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 0.85rem', borderRadius: '6px', fontSize: '0.85rem', fontWeight: 600 }}><Ticket size={14}/> Jira Story</button>
          <button type="button" className={`btn btn-secondary btn-small ${mode === 'acceptance' ? 'active-app-border' : ''}`} onClick={() => handleModeChange('acceptance')} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 0.85rem', borderRadius: '6px', fontSize: '0.85rem', fontWeight: 600 }}><ClipboardList size={14}/> Acceptance Criteria</button>
          <button type="button" className={`btn btn-secondary btn-small ${mode === 'file' ? 'active-app-border' : ''}`} onClick={() => handleModeChange('file')} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 0.85rem', borderRadius: '6px', fontSize: '0.85rem', fontWeight: 600 }}><FileUp size={14}/> User Story File *</button>
          <button type="button" className={`btn btn-secondary btn-small ${mode === 'wireframe' ? 'active-app-border' : ''}`} onClick={() => handleModeChange('wireframe')} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 0.85rem', borderRadius: '6px', fontSize: '0.85rem', fontWeight: 600 }}><Image size={14}/> Wireframe Capture *</button>
          <button type="button" className={`btn btn-secondary btn-small ${mode === 'crawler' ? 'active-app-border' : ''}`} onClick={() => handleModeChange('crawler')} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 0.85rem', borderRadius: '6px', fontSize: '0.85rem', fontWeight: 600 }}><Radar size={14}/> Crawler Data</button>
          <input type="file" multiple ref={fileInputRef} style={{ display: 'none' }} accept={modeConfig[mode].accept} onChange={handleFileChange} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1.5rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <textarea className="textarea-field" placeholder={modeConfig[mode].placeholder} value={sourceInput} onChange={(e) => setSourceInput(e.target.value)} style={{ minHeight: '130px', width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid rgba(148,163,184,0.22)', fontSize: '0.9rem', outline: 'none' }} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: '#6B7280', letterSpacing: '0.02em' }}>Batch Name</span>
                <input className="input-field" style={{ height: '42px', padding: '0 0.75rem', borderRadius: '8px', border: '1px solid rgba(148,163,184,0.22)' }} value={batchName} onChange={(e) => setBatchName(e.target.value)} placeholder="Optional — e.g. Checkout Flow (defaults to file name)" />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: '#6B7280', letterSpacing: '0.02em' }}>Context / Test Data</span>
                <input className="input-field" style={{ height: '42px', padding: '0 0.75rem', borderRadius: '8px', border: '1px solid rgba(148,163,184,0.22)' }} value={appContextInput} onChange={(e) => setAppContextInput(e.target.value)} placeholder="e.g. url, parameters, rules..." />
              </div>
            </div>

            {/* Data source override — Auto lets the backend keep auto-matching
                templates per test case (default, unchanged behavior). Picking
                a specific Template/Condition/Batch forces that source for the
                whole run instead — cheaper and predictable once there are many
                templates. Batches assign one distinct record per test case,
                round-robin, so the run still gets data variety. */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: '#6B7280', letterSpacing: '0.02em' }}>Data Source</span>
              <select
                className="input-field"
                value={dataSourceSelection}
                onChange={(e) => setDataSourceSelection(e.target.value)}
                style={{ height: '42px', padding: '0 0.75rem', borderRadius: '8px', border: '1px solid rgba(148,163,184,0.22)', width: '100%' }}
              >
                <option value="">Auto — AI picks the best-matching template per test case</option>
                {dataSourceTemplates.length > 0 && (
                  <optgroup label="Data Templates">
                    {dataSourceTemplates.map((t: any) => (
                      <option key={t.id} value={`template:${t.id}`}>{t.name} ({t.scenario})</option>
                    ))}
                  </optgroup>
                )}
                {dataSourceConditions.length > 0 && (
                  <optgroup label="Synthetic Conditions">
                    {dataSourceConditions.map((c: any) => (
                      <option key={c.id} value={`condition:${c.id}`}>{c.description}</option>
                    ))}
                  </optgroup>
                )}
                {dataSourceBatches.length > 0 && (
                  <optgroup label="Bulk Batches">
                    {dataSourceBatches.map((b: any) => (
                      <option key={b.id} value={`batch:${b.id}`}>{b.name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
              {dataSourceSelection.startsWith('batch:') && (
                <span style={{ fontSize: '0.75rem', color: '#6B7280' }}>
                  Records are assigned one per test case, round-robin, so this run's test cases won't all share the same data.
                </span>
              )}
            </div>
          </div>
          <div style={{ background: '#F3F4F7', padding: '1.25rem', borderRadius: '10px', border: '1px solid rgba(148,163,184,0.16)', display: 'flex', flexDirection: 'column' }}>
            {mode === 'crawler' ? (
              <>
                <h4 style={{ fontSize: '0.75rem', color: '#6B7280', textTransform: 'uppercase', fontWeight: 700, marginBottom: '0.8rem', letterSpacing: '0.02em', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <Radar size={13} /> Crawled Pages
                </h4>
                {crawlLoading && <p style={{ fontSize: '0.8rem', color: '#6B7280', margin: 'auto', textAlign: 'center' }}>Loading crawl data…</p>}
                {crawlError && <p style={{ fontSize: '0.78rem', color: '#C7402B' }}>{crawlError}</p>}
                {!crawlLoading && !crawlError && !crawlSession && (
                  <p style={{ fontSize: '0.85rem', color: '#6B7280', margin: 'auto', textAlign: 'center', lineHeight: '1.4' }}>
                    No crawl found for this app yet. Run one from the Crawler tab first.
                  </p>
                )}
                {!crawlLoading && crawlSession && (crawlSession.pages || []).length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', overflowY: 'auto', maxHeight: '220px' }}>
                    {crawlSession.pages.filter((p: any) => p.status === 'ok').map((p: any) => (
                      <label key={p.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', background: '#FFFFFF', padding: '8px 10px', borderRadius: '6px', fontSize: '0.78rem', border: '1px solid rgba(148,163,184,0.16)', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={selectedCrawlPageIds.includes(p.id)}
                          onChange={() => toggleCrawlPage(p.id)}
                          style={{ marginTop: '2px', flexShrink: 0 }}
                        />
                        <span style={{ minWidth: 0 }}>
                          <span style={{ display: 'block', color: '#14151A', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title || 'Untitled'}</span>
                          <span style={{ display: 'block', color: '#6B7280', fontFamily: 'monospace', fontSize: '0.68rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.url} · {p.elementCount} elements</span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <>
                <h4 style={{ fontSize: '0.75rem', color: '#6B7280', textTransform: 'uppercase', fontWeight: 700, marginBottom: '0.8rem', letterSpacing: '0.02em' }}>Staged Files Queue</h4>
                {stagedFiles.length === 0 ? (
                  <p style={{ fontSize: '0.85rem', color: '#6B7280', margin: 'auto', textAlign: 'center', lineHeight: '1.4' }}>No source files attached.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', overflowY: 'auto', maxHeight: '160px' }}>
                    {stagedFiles.map((f) => (
                      <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#FFFFFF', padding: '8px 12px', borderRadius: '6px', fontSize: '0.8rem', border: '1px solid rgba(148,163,184,0.16)' }}>
                        <span className="environment-url" style={{ color: '#4B4E5A', fontWeight: 500 }} title={f.file.name}>{f.file.name}</span>
                        <X size={14} style={{ cursor: 'pointer', color: '#C7402B' }} onClick={() => setStagedFiles(prev => prev.filter(file => file.id !== f.id))} />
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        <button type="button" className="btn btn-primary" style={{ width: '100%', marginTop: '1.5rem', height: '44px', borderRadius: '8px', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }} onClick={triggerGeneration} disabled={isGenerating || !isFormValid}>
          <Sparkles size={16}/> <span>Compile Generation Suite</span>
        </button>

        {/* Reopens the live tech-logs modal whenever generation is still running but the
            modal was closed. Without this, closing "Close Analytics Dashboard" mid-run left
            no way back to the Stop Generation button anywhere on the page — the sidebar
            showed "Compiling..." with no control to act on it. Clicking this re-opens the
            SAME modal instance (state was never torn down), not a fresh one, so logs/metrics
            already streamed in are still there, and Stop Generation is reachable again. */}
        {isGenerating && !showModal && (
          <button
            type="button"
            onClick={() => setShowModal(true)}
            style={{
              width: '100%',
              marginTop: '0.75rem',
              height: '44px',
              borderRadius: '8px',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.6rem',
              background: 'rgba(248,113,113,0.12)',
              border: '1px solid rgba(248,113,113,0.35)',
              color: '#C7402B',
              cursor: 'pointer',
              fontSize: '0.85rem',
              animation: 'otai-pulse-border 1.6s ease-in-out infinite'
            }}
          >
            <Terminal size={16} />
            <span>Generation in progress — view logs / stop</span>
          </button>
        )}
        <style>{`
          @keyframes otai-pulse-border {
            0%, 100% { border-color: rgba(248,113,113,0.35); }
            50% { border-color: #C7402B; }
          }
        `}</style>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', paddingBottom: '2rem' }}>
        {generationBatches.filter((batch) => {
          return batch.appId === activeAppId;
        }).map((batch) => {
          const batchIds = batch.testCases.map((t: any) => t.id);
          const selectedInBatchCount = batch.testCases.filter((t: any) => selectedCardIds.includes(t.id)).length;
          const isAllBatchChecked = batchIds.length > 0 && batchIds.every((id: any) => selectedCardIds.includes(id));
          const isDropdownOpen = activeExportDropdownId === batch.id;

          return (
            <div key={batch.id} className="glass-card" style={{ padding: 0, overflow: 'visible', background: '#FFFFFF', border: '1px solid rgba(148,163,184,0.16)', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.01)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.25rem', background: '#F3F4F7', borderBottom: '1px solid rgba(148,163,184,0.16)', borderTopLeftRadius: '12px', borderTopRightRadius: '12px' }}>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <div style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', color: isAllBatchChecked ? '#0E8F82' : 'rgba(148,163,184,0.22)' }} onClick={() => handleToggleSelectAllBatch(batch.testCases)}>
                    {isAllBatchChecked ? <CheckSquare size={19} /> : <Square size={19} />}
                  </div>

                  <div onClick={() => setGenerationBatches(generationBatches.map(b => b.id === batch.id ? {...b, isCollapsed: !b.isCollapsed} : b))} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                    {batch.isCollapsed ? <ChevronRight size={16} style={{ color: '#6B7280' }} /> : <ChevronDown size={16} style={{ color: '#6B7280' }} />}
                    <FileText size={16} style={{ color: '#2A4CE0' }} />
                    <strong style={{ fontSize: '0.95rem', color: '#14151A' }}>{batch.batchName || batch.sourceLabel}</strong>
                    <span style={{ fontSize: '0.75rem', background: 'rgba(56,189,248,0.12)', color: '#1D6FB8', padding: '2px 8px', borderRadius: '12px', fontWeight: 700, marginLeft: '0.25rem' }}>{batch.testCases.length} Tests</span>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', position: 'relative' }} ref={isDropdownOpen ? dropdownRef : null}>
                  {selectedInBatchCount > 0 ? (
                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      <button type="button" className="btn btn-secondary btn-small" style={{ borderColor: '#C7402B', color: '#C7402B', fontWeight: 600, height: '32px', borderRadius: '6px', padding: '0 0.75rem', background: 'rgba(248,113,113,0.10)' }} onClick={() => handleBulkDeleteFromBatch(batch.id, batch.testCases)}>
                        Delete Selected ({selectedInBatchCount})
                      </button>
                      <button type="button" className="btn btn-secondary btn-small" disabled={savingBatchId === batch.id} style={{ borderColor: savingBatchId === batch.id ? '#6B7280' : '#2A4CE0', background: savingBatchId === batch.id ? '#E7E9EE' : 'rgba(34,211,238,0.12)', color: savingBatchId === batch.id ? '#6B7280' : '#2A4CE0', fontWeight: 700, height: '32px', borderRadius: '6px', padding: '0 0.75rem', cursor: savingBatchId === batch.id ? 'not-allowed' : 'pointer' }} onClick={() => handleSaveSelectedToRepo(batch.id, batch.testCases)}>
                        {savingBatchId === batch.id ? 'Saving...' : `Save Selected (${selectedInBatchCount})`}
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      <button type="button" className="btn btn-secondary btn-small" onClick={() => { setActiveExportDropdownId(isDropdownOpen ? null : batch.id); }} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', height: '32px', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 600, border: '1px solid rgba(148,163,184,0.16)', background: '#FFFFFF' }}>
                        <Download size={13} /> Export Menu <ChevronDown size={11} />
                      </button>

                      {isDropdownOpen && (
                        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: '0', background: '#FFFFFF', border: '1px solid rgba(148,163,184,0.16)', borderRadius: '8px', padding: '4px', zIndex: 100, minWidth: '140px', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.05)' }}>
                          <button type="button" onClick={() => executeDirectExport(batch.testCases, 'json')} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '8px 12px', fontSize: '0.8rem', fontWeight: 600, color: '#4B4E5A', cursor: 'pointer', borderRadius: '6px' }} onMouseEnter={(e) => e.currentTarget.style.background = '#E7E9EE'} onMouseLeave={(e) => e.currentTarget.style.background = 'none'}>Download JSON</button>
                          <button type="button" onClick={() => executeDirectExport(batch.testCases, 'csv')} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '8px 12px', fontSize: '0.8rem', fontWeight: 600, color: '#4B4E5A', cursor: 'pointer', borderRadius: '6px' }} onMouseEnter={(e) => e.currentTarget.style.background = '#E7E9EE'} onMouseLeave={(e) => e.currentTarget.style.background = 'none'}>Download CSV</button>
                          <button type="button" onClick={() => executeDirectExport(batch.testCases, 'txt')} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '8px 12px', fontSize: '0.8rem', fontWeight: 600, color: '#4B4E5A', cursor: 'pointer', borderRadius: '6px' }} onMouseEnter={(e) => e.currentTarget.style.background = '#E7E9EE'} onMouseLeave={(e) => e.currentTarget.style.background = 'none'}>Download Text</button>
                        </div>
                      )}

                      <button type="button" className="btn btn-secondary btn-small" onClick={() => executeDirectCopy(batch.testCases)} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', height: '32px', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 600, border: '1px solid rgba(148,163,184,0.16)', background: '#FFFFFF' }}><Copy size={13} /> Copy Suite</button>
                      <button type="button" className="btn btn-accent btn-small" disabled={savingBatchId === batch.id} style={{ height: '32px', borderRadius: '6px', fontSize: '0.8rem', padding: '0 0.85rem', background: savingBatchId === batch.id ? '#6B7280' : undefined, cursor: savingBatchId === batch.id ? 'not-allowed' : 'pointer' }} onClick={() => handleSaveSelectedToRepo(batch.id, batch.testCases, batch.testCases.map((t: any) => t.id))}>{savingBatchId === batch.id ? 'Saving...' : 'Save All to Repo'}</button>
                    </div>
                  )}

                  <button type="button" className="btn btn-secondary btn-small" onClick={() => handleReopenModalForBatch(batch)} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', height: '32px', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 600, border: '1px solid rgba(148,163,184,0.16)', background: '#FFFFFF' }}><Terminal size={13} /> Tech Logs</button>
                </div>
              </div>

              {!batch.isCollapsed && (
                <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1.25rem', background: '#FFFFFF' }}>
                  {(() => {
                    const activeTab = activeCategoryTab[batch.id] || 'all';
                    const allCount = batch.testCases.length;
                    const visibleCategories = activeTab === 'all' ? CATEGORY_ORDER : [activeTab];

                    return (
                      <>
                        {/* Horizontal category tab bar — replaces the old stacked,
                            individually-collapsible category list. "All" is the
                            default view; picking a category filters the list
                            below to just that section. */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', paddingBottom: '1.1rem', borderBottom: '1px solid #E7E9EE' }}>
                          <button
                            type="button"
                            onClick={() => setActiveCategoryTab(prev => ({ ...prev, [batch.id]: 'all' }))}
                            style={{
                              display: 'flex', alignItems: 'center', gap: '0.4rem',
                              background: activeTab === 'all' ? '#14151A' : '#F3F4F7',
                              color: activeTab === 'all' ? '#fff' : '#4B4E5A',
                              border: `1px solid ${activeTab === 'all' ? '#14151A' : 'rgba(148,163,184,0.22)'}`,
                              borderRadius: '20px', padding: '0.42rem 0.95rem', fontSize: '0.8rem', fontWeight: 700,
                              cursor: 'pointer', transition: 'all 0.15s ease',
                            }}
                          >
                            All <span style={{ opacity: 0.7 }}>({allCount})</span>
                          </button>
                          {CATEGORY_ORDER.map((catKey) => {
                            const groupTests = batch.testCases.filter((t: any) => (t.category || 'functional') === catKey);
                            if (!groupTests.length) return null;
                            const meta = CATEGORY_META[catKey];
                            const isActive = activeTab === catKey;
                            return (
                              <button
                                key={catKey}
                                type="button"
                                onClick={() => setActiveCategoryTab(prev => ({ ...prev, [batch.id]: catKey }))}
                                style={{
                                  display: 'flex', alignItems: 'center', gap: '0.4rem',
                                  background: isActive ? meta.color : meta.bg,
                                  color: isActive ? '#fff' : meta.color,
                                  border: `1px solid ${isActive ? meta.color : meta.border}`,
                                  borderRadius: '20px', padding: '0.42rem 0.95rem', fontSize: '0.8rem', fontWeight: 700,
                                  cursor: 'pointer', transition: 'all 0.15s ease',
                                }}
                              >
                                {meta.label} <span style={{ opacity: 0.8 }}>({groupTests.length})</span>
                              </button>
                            );
                          })}
                        </div>

                        {visibleCategories.map((catKey) => {
                          const groupTests = batch.testCases.filter((t: any) => (t.category || 'functional') === catKey);
                          if (!groupTests.length) return null;
                          const meta = CATEGORY_META[catKey];
                          return (
                            <div key={catKey} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                  <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: meta.color, display: 'inline-block' }} />
                                  <span style={{ fontSize: '0.85rem', fontWeight: 700, color: meta.color }}>{meta.label}</span>
                                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: meta.color, opacity: 0.7 }}>({groupTests.length})</span>
                                </div>
                                {/* Save just this section — independent of "Save All to
                                    Repo" above, which still saves the whole batch. */}
                                <button
                                  type="button"
                                  disabled={savingBatchId === batch.id}
                                  onClick={() => handleSaveSelectedToRepo(batch.id, batch.testCases, groupTests.map((t: any) => t.id))}
                                  style={{
                                    display: 'flex', alignItems: 'center', gap: '0.35rem', background: 'transparent',
                                    border: `1px solid ${meta.border}`, color: meta.color, borderRadius: '6px',
                                    padding: '0.3rem 0.7rem', fontSize: '0.75rem', fontWeight: 700,
                                    cursor: savingBatchId === batch.id ? 'not-allowed' : 'pointer',
                                    opacity: savingBatchId === batch.id ? 0.55 : 1,
                                  }}
                                >
                                  <Download size={11} /> Save {meta.label} to Repo
                                </button>
                              </div>

                              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                {groupTests.map((test: any) => {
                                  const isChecked = selectedCardIds.includes(test.id);
                                  const isCurrentlyEditing = editingCardId === test.id;
                                  return (
                                    <div key={test.id} className="generated-test-card" style={{ padding: '1.25rem', background: '#FFFFFF', border: '1px solid rgba(148,163,184,0.16)', borderRadius: '8px', display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
                                      <div style={{ marginTop: '0.2rem', cursor: 'pointer', color: isChecked ? '#2A4CE0' : 'rgba(148,163,184,0.22)' }} onClick={() => handleCardSelectionToggle(test.id)}>
                                        {isChecked ? <CheckSquare size={18} /> : <Square size={18} />}
                                      </div>
                                      <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', borderBottom: '1px solid #E7E9EE', paddingBottom: '0.5rem' }}>
                                          {isCurrentlyEditing ? (
                                            <div style={{ display: 'flex', gap: '0.5rem', flex: 1 }}>
                                              <input type="text" className="input-field" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} style={{ height: '32px', width: '100%', borderRadius: '6px', border: '1px solid rgba(148,163,184,0.22)', padding: '0 0.5rem', fontSize: '0.9rem' }} />
                                              <button type="button" className="btn btn-accent btn-small" style={{ height: '32px', borderRadius: '6px', padding: '0 0.75rem' }} onClick={() => saveInlineEdit(batch.id)}>Save</button>
                                            </div>
                                          ) : (
                                            <>
                                              <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#14151A', margin: 0 }}>{test.title}</h3>
                                              <div style={{ display: 'flex', gap: '0.35rem' }}>
                                                <button type="button" className="btn btn-secondary btn-small" style={{ padding: '4px', border: '1px solid rgba(148,163,184,0.16)', background: '#FFFFFF', borderRadius: '4px' }} onClick={() => openInlineEdit(test.id, test.title)}><Edit2 size={12} style={{ color: '#6B7280' }} /></button>
                                                <button type="button" className="btn btn-secondary btn-small" style={{ padding: '4px', border: '1px solid rgba(248,113,113,0.14)', background: 'rgba(248,113,113,0.10)', borderRadius: '4px' }} onClick={() => setGenerationBatches(prev => prev.map(b => b.id === batch.id ? { ...b, testCases: b.testCases.filter((t: any) => t.id !== test.id) } : b).filter(b => b.testCases.length > 0))}><Trash2 size={12} style={{ color: '#C7402B' }} /></button>
                                              </div>
                                            </>
                                          )}
                                        </div>
                                        <ol style={{ paddingLeft: '1.25rem', fontSize: '0.85rem', color: '#6B7280', display: 'flex', flexDirection: 'column', gap: '0.4rem', margin: 0 }}>
                                          {test.steps.map((s: any, sIdx: number) => (
                                            <li key={sIdx} style={{ lineHeight: '1.5' }}>
                                              {s.instruction} <span style={{ color: '#2A4CE0', fontWeight: 600 }}>{'→'} {s.expected}</span>
                                            </li>
                                          ))}
                                        </ol>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(15, 23, 42, 0.45)', backdropFilter: 'blur(8px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
          <div className="glass-card" style={{ width: '100%', maxWidth: '920px', maxHeight: '88vh', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden', border: '1px solid rgba(148,163,184,0.18)', background: '#FFFFFF', borderRadius: '16px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.05)' }}>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.25rem', borderBottom: '1px solid #E7E9EE', background: '#F3F4F7' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <div style={{ background: 'rgba(56,189,248,0.12)', padding: '6px', borderRadius: '6px', display: 'flex', alignItems: 'center' }}>
                  <Cpu size={18} style={{ color: '#1D6FB8' }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <h2 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#14151A', margin: 0 }}>OmniTestAI Generation Analytics</h2>
                  <span style={{ fontSize: '0.7rem', color: '#4C63D2', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: '1px' }}>Active Batch: {activeBatchTitle}</span>
                </div>
              </div>
              <button type="button" style={{ background: '#FFFFFF', border: '1px solid rgba(148,163,184,0.18)', color: '#6B7280', cursor: 'pointer', padding: '6px', borderRadius: '50%' }} onClick={() => setShowModal(false)}><X size={16} /></button>
            </div>

            <div style={{ padding: '1.5rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.5rem', flex: 1, background: '#FFFFFF' }}>

              <>
                <div style={{ background: '#0B0D12', padding: '1.25rem', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.14)', fontFamily: 'monospace', boxShadow: '0 4px 10px rgba(0,0,0,0.2)' }}>
                    <div style={{ borderBottom: '1px solid rgba(255,255,255,0.12)', paddingBottom: '0.5rem', marginBottom: '0.75rem', display: 'flex', gap: '4px', alignItems: 'center' }}>
                       <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ff5f56' }}></div>
                       <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ffbd2e' }}></div>
                       <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#27c93f' }}></div>
                       <span style={{ fontSize: '0.65rem', color: '#6B7280', marginLeft: '0.5rem', fontWeight: 700, letterSpacing: '0.05em' }}>EXECUTION_LOG</span>
                       {generationElapsedSec !== null && (
                         <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: '#6B7280', fontFamily: 'monospace' }}>⏱ {generationElapsedSec}s</span>
                       )}
                    </div>
                    <div style={{ minHeight: '100px', maxHeight: '160px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {modalLogs.map((log, index) => (
                        <div key={index} style={{ color: log.type === 'success' ? '#157F52' : log.type === 'warning' ? '#B4790A' : '#1D6FB8', fontSize: '0.8rem', lineHeight: '1.4' }}>
                          <span style={{ color: '#4B4E5A' }}>[{log.timestamp}]</span> <span style={{ fontWeight: 'bold' }}>{log.type.toUpperCase()}:</span> <span>{log.message}</span>
                        </div>
                      ))}
                      <div ref={consoleBottomRef} />
                    </div>
                  </div>

                  {activeBatchMetrics && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 2fr', gap: '1.5rem' }}>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        <div style={{ background: '#F3F4F7', border: '1px solid rgba(148,163,184,0.18)', padding: '1.25rem', borderRadius: '10px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.75rem' }}>
                            <Layers size={14} style={{ color: '#4C63D2' }} />
                            <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Test Type Breakdown</span>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: '0.8rem', color: '#6B7280', fontWeight: 500 }}>Happy Path (positive)</span>
                              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#157F52', background: 'rgba(74,222,128,0.14)', padding: '2px 8px', borderRadius: '4px' }}>{activeBatchMetrics.happyPaths}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: '0.8rem', color: '#6B7280', fontWeight: 500 }}>Boundary / Edge Cases</span>
                              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#8F5D08', background: 'rgba(251,191,36,0.14)', padding: '2px 8px', borderRadius: '4px' }}>{activeBatchMetrics.edgeCases}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: '0.8rem', color: '#6B7280', fontWeight: 500 }}>Negative / Error Flows</span>
                              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#C7402B', background: 'rgba(248,113,113,0.14)', padding: '2px 8px', borderRadius: '4px' }}>{activeBatchMetrics.negativeFlows}</span>
                            </div>
                          </div>
                        </div>
                        {generationElapsedSec !== null && (
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.4rem 0.75rem', background: '#E7E9EE', borderRadius: '6px', border: '1px solid rgba(148,163,184,0.18)' }}>
                            <span style={{ fontSize: '0.72rem', color: '#6B7280', fontWeight: 600, letterSpacing: '0.03em' }}>⏱ Generation Time</span>
                            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#000000', fontFamily: 'monospace' }}>{generationElapsedSec}s</span>
                          </div>
                        )}
                      </div>

                      <div style={{ background: '#0B0D12', borderRadius: '12px', padding: '1.25rem', fontFamily: 'monospace', fontSize: '0.75rem', border: '1px solid rgba(255,255,255,0.14)', display: 'flex', flexDirection: 'column' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                          <span style={{ color: '#1D6FB8', fontWeight: 700 }}>GEMINI CALL TRACE</span>
                          {activeBatchMetrics.generationTrace && (
                            <span style={{ color: '#157F52', fontSize: '0.65rem', background: 'rgba(16,185,129,0.1)', padding: '2px 6px', borderRadius: '4px' }}>{activeBatchMetrics.generationTrace.model}</span>
                          )}
                        </div>

                        {activeBatchMetrics.generationTrace ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem', color: '#6B7280', flex: 1 }}>
                            <div>
                              <div style={{ color: '#F3F4F7', marginBottom: '0.2rem' }}>[01] PASS 1 — Blueprint Discovery:</div>
                              <div style={{ paddingLeft: '0.75rem', borderLeft: '1px solid #4B4E5A' }}>
                                - Time: {activeBatchMetrics.generationTrace.pass1_time_sec}s<br />
                                - Tokens: {activeBatchMetrics.generationTrace.pass1_input_tokens} in / {activeBatchMetrics.generationTrace.pass1_output_tokens} out
                                {activeBatchMetrics.generationTrace.topup_fired && (
                                  <><br />- Top-up retry fired: +{activeBatchMetrics.generationTrace.topup_input_tokens} in / +{activeBatchMetrics.generationTrace.topup_output_tokens} out</>
                                )}
                                {activeBatchMetrics.generationTrace.ai_decided_count != null && (
                                  <><br />- AI decided count: {activeBatchMetrics.generationTrace.ai_decided_count} (bounds: {activeBatchMetrics.generationTrace.min_bound}–{activeBatchMetrics.generationTrace.max_bound})</>
                                )}
                              </div>
                              {activeBatchMetrics.generationTrace.feature_breakdown && Object.keys(activeBatchMetrics.generationTrace.feature_breakdown).length > 0 && (
                                <div style={{ paddingLeft: '0.75rem', marginTop: '0.5rem' }}>
                                  <div style={{ color: '#6B7280', marginBottom: '0.25rem' }}>Per-feature breakdown:</div>
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                                    {Object.entries(activeBatchMetrics.generationTrace.feature_breakdown as Record<string, number>).map(([feature, n]) => (
                                      <span key={feature} style={{ background: 'rgba(56,189,248,0.1)', color: '#1D6FB8', borderRadius: '4px', padding: '2px 6px', fontSize: '0.7rem' }}>
                                        {feature}: {n}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>

                            {activeBatchMetrics.generationTrace.category_breakdown && (
                              <div>
                                <div style={{ color: '#F3F4F7', marginBottom: '0.2rem' }}>[01b] Category Split:</div>
                                <div style={{ paddingLeft: '0.75rem', borderLeft: '1px solid #4B4E5A', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                                  {CATEGORY_ORDER.map((catKey) => {
                                    const breakdown = activeBatchMetrics.generationTrace.category_breakdown as Record<string, number>;
                                    const targets = activeBatchMetrics.generationTrace.category_targets as Record<string, { target: number; min: number; max: number }> | undefined;
                                    if (!(catKey in breakdown)) return null;
                                    const count = breakdown[catKey];
                                    const t = targets?.[catKey];
                                    const meta = CATEGORY_META[catKey];
                                    // Flag when a category landed right at its configured floor/ceiling —
                                    // this is the "monitor carefully, not too low or too many" visibility
                                    // the category-split feature needs, surfaced per-category instead of
                                    // trusting the count silently.
                                    const atBound = t && (count <= t.min || count >= t.max);
                                    return (
                                      <div key={catKey} style={{ color: '#6B7280' }}>
                                        <span style={{ color: meta?.color || '#1D6FB8' }}>{meta?.label || catKey}</span>: {count}
                                        {t && <span style={{ color: '#6B7280' }}> (target ~{t.target}, bounds {t.min}–{t.max})</span>}
                                        {atBound && <span style={{ color: '#B4790A' }}> ⚠ at bound — verify coverage</span>}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            <div>
                              <div style={{ color: '#F3F4F7', marginBottom: '0.2rem' }}>[02] PASS 2 — Step Expansion:</div>
                              <div style={{ paddingLeft: '0.75rem', borderLeft: '1px solid #4B4E5A' }}>
                                - Time: {activeBatchMetrics.generationTrace.pass2_time_sec}s<br />
                                - Calls: {activeBatchMetrics.generationTrace.pass2_call_count}<br />
                                - Tokens: {activeBatchMetrics.generationTrace.pass2_input_tokens} in / {activeBatchMetrics.generationTrace.pass2_output_tokens} out
                              </div>
                            </div>

                            <div style={{ marginTop: 'auto', padding: '0.6rem', background: 'rgba(30, 41, 59, 0.4)', borderRadius: '6px', color: '#1D6FB8', lineHeight: '1.4' }}>
                              <strong>TOTAL:</strong> {activeBatchMetrics.generationTrace.total_tokens} tokens across {activeBatchMetrics.generationTrace.total_time_sec}s.
                            </div>
                          </div>
                        ) : (
                          <div style={{ color: '#6B7280' }}>No trace data available for this batch.</div>
                        )}
                      </div>

                    </div>
                  )}
              </>
            </div>

            <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid #E7E9EE', background: '#F3F4F7', display: 'flex', justifyContent: 'flex-end' }}>
              {isGenerating && (
                <button type="button" onClick={handleStopGeneration} style={{ background: 'rgba(248,113,113,0.14)', border: '1px solid #C7402B', color: '#C7402B', fontWeight: 700, borderRadius: '6px', height: '34px', padding: '0 1rem', cursor: 'pointer', fontSize: '0.85rem' }}>
                  ⏹ Stop Generation
                </button>
              )}
              <button type="button" className="btn btn-secondary btn-small" onClick={() => setShowModal(false)} style={{ background: '#FFFFFF', border: '1px solid rgba(148,163,184,0.22)', color: '#4B4E5A', fontWeight: 600, borderRadius: '6px', height: '34px', padding: '0 1rem', cursor: 'pointer' }}>Close Analytics Dashboard</button>
            </div>
          </div>
        </div>
      )}

      {showCoverageModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
          <div className="glass-card" style={{ width: '100%', maxWidth: '820px', maxHeight: '88vh', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden', border: '1px solid rgba(148,163,184,0.18)', background: '#FFFFFF', borderRadius: '16px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.05)' }}>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.25rem', borderBottom: '1px solid #E7E9EE', background: '#F3F4F7' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <div style={{ background: 'rgba(129,140,248,0.12)', padding: '6px', borderRadius: '6px', display: 'flex', alignItems: 'center' }}>
                  <Activity size={18} style={{ color: '#4C63D2' }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <h2 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#14151A', margin: 0 }}>Coverage Index</h2>
                  <span style={{ fontSize: '0.7rem', color: '#4C63D2', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: '1px' }}>{activeApp?.name || 'No application selected'}</span>
                </div>
              </div>
              <button type="button" style={{ background: '#FFFFFF', border: '1px solid rgba(148,163,184,0.18)', color: '#6B7280', cursor: 'pointer', padding: '6px', borderRadius: '50%' }} onClick={() => setShowCoverageModal(false)}><X size={16} /></button>
            </div>

            <div style={{ padding: '1.5rem', overflowY: 'auto', flex: 1, background: '#FFFFFF' }}>
              <CoverageIndexPanel
                loading={scoutLoading}
                error={scoutError}
                profile={scoutProfile}
                pageLimitInput={scoutPageLimitInput}
                setPageLimitInput={setScoutPageLimitInput}
                onRescan={handleRescanApplication}
              />
            </div>

            <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid #E7E9EE', background: '#F3F4F7', display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-secondary btn-small" onClick={() => setShowCoverageModal(false)} style={{ background: '#FFFFFF', border: '1px solid rgba(148,163,184,0.22)', color: '#4B4E5A', fontWeight: 600, borderRadius: '6px', height: '34px', padding: '0 1rem', cursor: 'pointer' }}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};