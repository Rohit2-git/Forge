import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import { apiService, BASE_URL } from '../services/api';
import type { CrawlSession, CrawlPage, CrawledElement } from '../types';
import {
    Radar, Play, Square, RefreshCw, Download, X, Save, ImageOff, AlertTriangle,
    CheckCircle2, Clock, Layers, MousePointerClick, ExternalLink, History
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────
// Crawler Agent — exhaustive, no-page-limit site crawl. For every same-origin
// page it can reach, it captures a full-page screenshot plus every
// interactive element's id/class/name/role/selector, so the Generator can
// later use that inventory as grounding context for reliable, selector-aware
// test cases (see the new "Crawler Data" mode in Generator.tsx).
//
// This is a standalone top-level section (its own Sidebar tab, below Test
// Data) rather than a tab inside AI Test Design — it has its own lifecycle
// (start/poll/browse/edit) independent of any one generation run.
// ─────────────────────────────────────────────────────────────────────────

const statusMeta: Record<string, { label: string; color: string; bg: string; border: string }> = {
    running: { label: 'Crawling…', color: '#fbbf24', bg: 'rgba(251,191,36,0.12)', border: 'rgba(251,191,36,0.4)' },
    completed: { label: 'Completed', color: '#4ade80', bg: 'rgba(74,222,128,0.12)', border: 'rgba(74,222,128,0.35)' },
    stopped: { label: 'Stopped', color: '#94a3b8', bg: 'rgba(148,163,184,0.14)', border: 'rgba(148,163,184,0.35)' },
    failed: { label: 'Failed', color: '#f87171', bg: 'rgba(248,113,113,0.12)', border: 'rgba(248,113,113,0.35)' },
};

const PageThumb: React.FC<{ path: string | null; alt: string }> = ({ path, alt }) => {
    const [errored, setErrored] = useState(false);
    if (!path || errored) {
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '120px', background: '#0b1120', borderRadius: '8px 8px 0 0', color: '#475569' }}>
                <ImageOff size={22} />
            </div>
        );
    }
    return (
        <img
            src={`${BASE_URL}${path}`}
            alt={alt}
            onError={() => setErrored(true)}
            style={{ width: '100%', height: '120px', objectFit: 'cover', objectPosition: 'top', borderRadius: '8px 8px 0 0', background: '#0b1120' }}
        />
    );
};

const PageDetailPanel: React.FC<{
    appId: string;
    pageId: string;
    onClose: () => void;
    onSaved: () => void;
}> = ({ appId, pageId, onClose, onSaved }) => {
    const [page, setPage] = useState<CrawlPage | null>(null);
    const [loading, setLoading] = useState(true);
    const [jsonText, setJsonText] = useState('');
    const [jsonError, setJsonError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [recrawling, setRecrawling] = useState(false);

    const load = async () => {
        setLoading(true);
        try {
            const data = await apiService.getCrawlPage(appId, pageId);
            setPage(data);
            setJsonText(JSON.stringify(data.elements || [], null, 2));
            setJsonError(null);
        } catch (err: any) {
            setJsonError(err.message || 'Failed to load page detail.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); /* eslint-disable-next-line */ }, [pageId]);

    const handleSave = async () => {
        let parsed: CrawledElement[];
        try {
            parsed = JSON.parse(jsonText);
            if (!Array.isArray(parsed)) throw new Error('Must be a JSON array of elements.');
        } catch (e: any) {
            setJsonError(`Invalid JSON: ${e.message}`);
            return;
        }
        setSaving(true);
        setJsonError(null);
        try {
            const updated = await apiService.updateCrawlPageElements(appId, pageId, parsed);
            setPage(updated);
            onSaved();
        } catch (err: any) {
            setJsonError(err.message || 'Save failed.');
        } finally {
            setSaving(false);
        }
    };

    const handleRecrawl = async () => {
        setRecrawling(true);
        try {
            const updated = await apiService.recrawlPage(appId, pageId);
            setPage(updated);
            setJsonText(JSON.stringify(updated.elements || [], null, 2));
            setJsonError(null);
            onSaved();
        } catch (err: any) {
            setJsonError(err.message || 'Recrawl failed.');
        } finally {
            setRecrawling(false);
        }
    };

    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(3,7,18,0.72)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }} onClick={onClose}>
            <div
                style={{ background: '#141c30', border: '1px solid rgba(148,163,184,0.2)', borderRadius: '14px', width: 'min(1000px, 100%)', maxHeight: '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
                onClick={(e) => e.stopPropagation()}
            >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.25rem', borderBottom: '1px solid rgba(148,163,184,0.14)' }}>
                    <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#f1f5f9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{page?.title || 'Untitled Page'}</div>
                        <a href={page?.url} target="_blank" rel="noreferrer" style={{ fontSize: '0.75rem', color: '#818cf8', display: 'flex', alignItems: 'center', gap: '4px', textDecoration: 'none' }}>
                            {page?.url} <ExternalLink size={11} />
                        </a>
                    </div>
                    <button type="button" onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', flexShrink: 0 }}><X size={20} /></button>
                </div>

                {loading ? (
                    <div style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>Loading page detail…</div>
                ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', padding: '1.25rem', overflowY: 'auto' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Screenshot</span>
                            {page?.screenshotPath ? (
                                <img src={`${BASE_URL}${page.screenshotPath}`} alt={page.title || page.url} style={{ width: '100%', borderRadius: '8px', border: '1px solid rgba(148,163,184,0.18)' }} />
                            ) : (
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px', background: '#0b1120', borderRadius: '8px', color: '#475569' }}>
                                    <ImageOff size={28} />
                                </div>
                            )}
                            <button
                                type="button"
                                onClick={handleRecrawl}
                                disabled={recrawling}
                                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', background: 'rgba(129,140,248,0.12)', border: '1px solid rgba(129,140,248,0.4)', color: '#a5b4fc', fontWeight: 700, fontSize: '0.78rem', borderRadius: '6px', padding: '0.5rem', cursor: recrawling ? 'default' : 'pointer', opacity: recrawling ? 0.6 : 1 }}
                            >
                                <RefreshCw size={13} className={recrawling ? 'spin' : ''} /> {recrawling ? 'Recrawling…' : 'Recrawl this page'}
                            </button>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', minHeight: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    Captured Elements ({page?.elementCount ?? 0}) — editable
                                </span>
                                {page?.editedAt && <span style={{ fontSize: '0.68rem', color: '#64748b' }}>Edited {new Date(page.editedAt).toLocaleString()}</span>}
                            </div>
                            <textarea
                                value={jsonText}
                                onChange={(e) => setJsonText(e.target.value)}
                                spellCheck={false}
                                style={{
                                    flex: 1, minHeight: '320px', width: '100%', padding: '0.75rem', borderRadius: '8px',
                                    border: `1px solid ${jsonError ? 'rgba(248,113,113,0.5)' : 'rgba(148,163,184,0.22)'}`,
                                    background: '#0b1120', color: '#cbd5e1', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                                    fontSize: '0.78rem', outline: 'none', resize: 'vertical',
                                }}
                            />
                            {jsonError && <span style={{ fontSize: '0.75rem', color: '#f87171' }}>{jsonError}</span>}
                            <button
                                type="button"
                                onClick={handleSave}
                                disabled={saving}
                                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', background: '#22d3ee', border: 'none', color: '#05070d', fontWeight: 700, fontSize: '0.82rem', borderRadius: '6px', padding: '0.55rem', cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.7 : 1 }}
                            >
                                <Save size={14} /> {saving ? 'Saving…' : 'Save Edits'}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export const CrawlerAgent: React.FC = () => {
    const { applications, activeAppId } = useApp();
    const activeApp = applications.find((a) => a.id === activeAppId);

    const [sessions, setSessions] = useState<CrawlSession[]>([]);
    const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
    const [session, setSession] = useState<CrawlSession | null>(null);
    const [loadingSession, setLoadingSession] = useState(false);
    const [starting, setStarting] = useState(false);
    const [stopping, setStopping] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [openPageId, setOpenPageId] = useState<string | null>(null);
    const pollRef = useRef<number | null>(null);

    const loadSessions = async (selectLatest: boolean) => {
        if (!activeAppId) return;
        try {
            const list = await apiService.listCrawlSessions(activeAppId);
            setSessions(list || []);
            if (selectLatest && list && list.length > 0) {
                setSelectedSessionId(list[0].id);
            }
        } catch (err: any) {
            setError(err.message || 'Failed to load crawl history.');
        }
    };

    const loadSession = async (sessionId: string) => {
        if (!activeAppId) return;
        setLoadingSession(true);
        try {
            const data = await apiService.getCrawlSession(activeAppId, sessionId);
            setSession(data);
            setError(null);
        } catch (err: any) {
            setError(err.message || 'Failed to load crawl session.');
        } finally {
            setLoadingSession(false);
        }
    };

    // Reset everything when the active app changes, then load its crawl history.
    useEffect(() => {
        setSession(null);
        setSessions([]);
        setSelectedSessionId(null);
        setError(null);
        if (activeAppId) loadSessions(true);
    }, [activeAppId]);

    useEffect(() => {
        if (selectedSessionId) loadSession(selectedSessionId);
    }, [selectedSessionId]);

    // Poll while the selected session is still running.
    useEffect(() => {
        if (pollRef.current) window.clearInterval(pollRef.current);
        if (session?.status === 'running' && selectedSessionId) {
            pollRef.current = window.setInterval(() => loadSession(selectedSessionId), 2500);
        }
        return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [session?.status, selectedSessionId]);

    const handleStart = async () => {
        if (!activeAppId) return;
        setStarting(true);
        setError(null);
        try {
            const newSession = await apiService.startCrawl(activeAppId);
            await loadSessions(false);
            setSelectedSessionId(newSession.id);
        } catch (err: any) {
            setError(err.message || 'Failed to start crawl.');
        } finally {
            setStarting(false);
        }
    };

    const handleStop = async () => {
        if (!activeAppId) return;
        setStopping(true);
        try {
            await apiService.stopCrawl(activeAppId);
        } catch (err: any) {
            setError(err.message || 'Failed to stop crawl.');
        } finally {
            setStopping(false);
        }
    };

    const handleExport = async () => {
        if (!activeAppId || !session) return;
        try {
            await apiService.exportCrawlSession(activeAppId, session.id);
        } catch (err: any) {
            setError(err.message || 'Export failed.');
        }
    };

    const isRunning = session?.status === 'running';
    const meta = session ? statusMeta[session.status] : null;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '1200px', margin: '0 auto', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem' }}>
                <div>
                    <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#f1f5f9', letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Radar size={24} style={{ color: '#22d3ee' }} /> Crawler Agent
                    </h1>
                    <p style={{ color: '#94a3b8', marginTop: '0.25rem', fontSize: '0.95rem', maxWidth: '640px' }}>
                        Crawls every reachable page of the application — no page limit — capturing each interactive
                        element's id, class, name, role, and a ready-to-use selector, plus a full-page screenshot.
                        Use the results as grounding context when generating test cases in AI Test Design.
                    </p>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                    {isRunning ? (
                        <button
                            type="button"
                            onClick={handleStop}
                            disabled={stopping}
                            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.4)', color: '#fca5a5', fontWeight: 700, fontSize: '0.85rem', borderRadius: '8px', padding: '0.55rem 0.9rem', cursor: stopping ? 'default' : 'pointer', opacity: stopping ? 0.6 : 1 }}
                        >
                            <Square size={14} /> {stopping ? 'Stopping…' : 'Stop Crawl'}
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={handleStart}
                            disabled={!activeAppId || starting}
                            title={!activeAppId ? 'Select an application first' : 'Crawl the entire application'}
                            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: '#22d3ee', border: 'none', color: '#05070d', fontWeight: 700, fontSize: '0.85rem', borderRadius: '8px', padding: '0.55rem 0.9rem', cursor: (!activeAppId || starting) ? 'default' : 'pointer', opacity: (!activeAppId || starting) ? 0.5 : 1 }}
                        >
                            <Play size={14} /> {starting ? 'Starting…' : 'Start Full Crawl'}
                        </button>
                    )}
                    {session && session.pagesCrawled > 0 && (
                        <button
                            type="button"
                            onClick={handleExport}
                            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'rgba(129,140,248,0.12)', border: '1px solid rgba(129,140,248,0.4)', color: '#a5b4fc', fontWeight: 700, fontSize: '0.85rem', borderRadius: '8px', padding: '0.55rem 0.9rem', cursor: 'pointer' }}
                        >
                            <Download size={14} /> Export JSON
                        </button>
                    )}
                </div>
            </div>

            {!activeAppId && (
                <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8', background: '#141c30', border: '1px solid rgba(148,163,184,0.16)', borderRadius: '12px' }}>
                    Select an application from the sidebar to run the Crawler Agent.
                </div>
            )}

            {activeAppId && sessions.length > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <History size={14} style={{ color: '#818cf8' }} />
                    <span style={{ fontSize: '0.78rem', color: '#94a3b8', fontWeight: 600 }}>Crawl history:</span>
                    <select
                        value={selectedSessionId || ''}
                        onChange={(e) => setSelectedSessionId(e.target.value)}
                        style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid rgba(148,163,184,0.22)', background: '#101828', color: '#e2e8f0', fontSize: '0.78rem' }}
                    >
                        {sessions.map((s) => (
                            <option key={s.id} value={s.id}>
                                {new Date(s.createdAt).toLocaleString()} · {s.pagesCrawled} pages · {statusMeta[s.status]?.label || s.status}
                            </option>
                        ))}
                    </select>
                </div>
            )}

            {error && (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.35)', color: '#fca5a5', padding: '0.85rem 1rem', borderRadius: '10px', fontSize: '0.8rem' }}>
                    <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: '1px' }} />
                    <span>{error}</span>
                </div>
            )}

            {activeAppId && !session && !loadingSession && (
                <div style={{ padding: '2.5rem', textAlign: 'center', color: '#94a3b8', background: '#141c30', border: '1px solid rgba(148,163,184,0.16)', borderRadius: '12px' }}>
                    No crawl yet for <strong style={{ color: '#e2e8f0' }}>{activeApp?.name}</strong>. Start one to build the element/screenshot inventory this app doesn't have yet.
                </div>
            )}

            {session && (
                <>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#101828', border: '1px solid rgba(148,163,184,0.18)', borderRadius: '10px', padding: '0.85rem 1rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                            {meta && (
                                <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', background: meta.bg, border: `1px solid ${meta.border}`, color: meta.color, fontWeight: 700, fontSize: '0.72rem', borderRadius: '999px', padding: '0.25rem 0.65rem' }}>
                                    {isRunning ? <RefreshCw size={11} className="spin" /> : session.status === 'completed' ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} />}
                                    {meta.label}
                                </span>
                            )}
                            <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>{session.baseUrl}</span>
                        </div>
                        {session.durationSec != null && (
                            <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem', color: '#94a3b8' }}>
                                <Clock size={12} /> {session.durationSec}s
                            </span>
                        )}
                    </div>

                    {session.errorMessage && (
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.35)', color: '#fca5a5', padding: '0.85rem 1rem', borderRadius: '10px', fontSize: '0.8rem' }}>
                            <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: '1px' }} />
                            <span>{session.errorMessage}</span>
                        </div>
                    )}

                    {session.authAttempted && (
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 0.85rem', borderRadius: '8px', fontSize: '0.78rem',
                            background: session.authSucceeded ? 'rgba(74,222,128,0.12)' : 'rgba(251,191,36,0.12)',
                            border: `1px solid ${session.authSucceeded ? 'rgba(74,222,128,0.35)' : 'rgba(251,191,36,0.5)'}`,
                            color: session.authSucceeded ? '#15803d' : '#92400e',
                        }}>
                            {session.authSucceeded
                                ? "✓ Detected a login wall and signed in with this app's Test Data before crawling — results reflect the authenticated app."
                                : '⚠ Detected a login wall but could not sign in — results only reflect the login page itself. Add a Test Data Template/Condition for this app and re-crawl.'}
                        </div>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                        <div style={{ background: '#101828', border: '1px solid rgba(148,163,184,0.18)', borderRadius: '10px', padding: '1rem' }}>
                            <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Pages Crawled</span>
                            <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#f1f5f9', marginTop: '2px' }}>{session.pagesCrawled}</div>
                        </div>
                        <div style={{ background: '#101828', border: '1px solid rgba(148,163,184,0.18)', borderRadius: '10px', padding: '1rem' }}>
                            <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Elements Captured</span>
                            <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#f1f5f9', marginTop: '2px' }}>{session.totalElements}</div>
                        </div>
                        <div style={{ background: '#101828', border: '1px solid rgba(148,163,184,0.18)', borderRadius: '10px', padding: '1rem' }}>
                            <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Pages Failed</span>
                            <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#f1f5f9', marginTop: '2px' }}>{(session.pages || []).filter(p => p.status === 'failed').length}</div>
                        </div>
                    </div>

                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.75rem' }}>
                            <MousePointerClick size={14} style={{ color: '#818cf8' }} />
                            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                Crawled Pages ({(session.pages || []).length})
                            </span>
                            <span style={{ fontSize: '0.72rem', color: '#64748b' }}>— click any page to review or edit what it captured</span>
                        </div>

                        {(session.pages || []).length === 0 ? (
                            <div style={{ padding: '1.5rem', textAlign: 'center', color: '#94a3b8', background: '#101828', border: '1px solid rgba(148,163,184,0.16)', borderRadius: '10px', fontSize: '0.85rem' }}>
                                {isRunning ? 'Crawling — pages will appear here as they\'re discovered…' : 'No pages captured.'}
                            </div>
                        ) : (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.85rem' }}>
                                {(session.pages || []).map((p) => (
                                    <button
                                        key={p.id}
                                        type="button"
                                        onClick={() => setOpenPageId(p.id)}
                                        style={{ textAlign: 'left', background: '#141c30', border: `1px solid ${p.status === 'failed' ? 'rgba(248,113,113,0.35)' : '#1a2338'}`, borderRadius: '10px', overflow: 'hidden', cursor: 'pointer', padding: 0, display: 'flex', flexDirection: 'column' }}
                                    >
                                        <PageThumb path={p.screenshotPath} alt={p.title || p.url} />
                                        <div style={{ padding: '0.6rem 0.7rem', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                            <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title || 'Untitled Page'}</span>
                                            <span style={{ fontSize: '0.68rem', color: '#818cf8', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.url}</span>
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '4px' }}>
                                                <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.68rem', color: '#94a3b8' }}>
                                                    <Layers size={11} /> {p.elementCount} elements
                                                </span>
                                                {p.status === 'failed' ? (
                                                    <span style={{ fontSize: '0.66rem', fontWeight: 700, color: '#f87171' }}>Failed</span>
                                                ) : p.editedAt ? (
                                                    <span style={{ fontSize: '0.66rem', fontWeight: 700, color: '#4ade80' }}>Edited</span>
                                                ) : null}
                                            </div>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </>
            )}

            {openPageId && activeAppId && (
                <PageDetailPanel
                    appId={activeAppId}
                    pageId={openPageId}
                    onClose={() => setOpenPageId(null)}
                    onSaved={() => { if (selectedSessionId) loadSession(selectedSessionId); }}
                />
            )}
        </div>
    );
};