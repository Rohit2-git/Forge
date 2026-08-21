import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import { apiService, BASE_URL } from '../services/api';
import type { CrawlSession, CrawlPage, CrawledElement } from '../types';
import {
  Radar, Play, Square, RefreshCw, X, Save, ImageOff, AlertTriangle,
  CheckCircle2, Clock, Layers, MousePointerClick, ExternalLink, History,
  Search, FileJson, FileText, Code2, LayoutGrid, MousePointer2, TextCursorInput,
  Link2, ClipboardList, ChevronRight, ChevronDown
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────
// Crawler Agent — exhaustive, no-page-limit site crawl. For every same-origin
// page it can reach, it captures a full-page screenshot plus every
// interactive element's id/class/name/role/selector, so the Generator can
// later use that inventory as grounding context for reliable, selector-aware
// test cases (see the "Crawler Data" mode in Generator.tsx).
//
// Display note: this page shows a compact "Crawl Batch" summary rather than
// a flat wall of page cards, and opens a dedicated Explorer (page list +
// detail pane) on demand — a grid of screenshot cards stopped being usable
// once a crawl produced dozens/hundreds of pages, since the only way to find
// a specific page was scrolling. The Explorer's page list is a single
// scrollable column with an optional search filter instead.
//
// Element detail display: each captured element has ~14 raw fields (tag, id,
// name, className, type, role, ariaLabel, placeholder, label, href, value,
// dataTestId, visible, selector, crawlId). Dumping all of that as JSON reads
// as noise — you can't tell what element you're looking at at a glance. The
// card view below surfaces just the 5 that actually identify an element at a
// glance (tag, label, id, class, selector); everything else is still
// captured and still present in JSON/text export and in the raw-JSON edit
// toggle, just not in the default read view.
// ─────────────────────────────────────────────────────────────────────────

const statusMeta: Record<string, { label: string; color: string; bg: string; border: string }> = {
  running:   { label: 'Crawling…', color: '#fbbf24', bg: 'rgba(251,191,36,0.12)', border: 'rgba(251,191,36,0.4)' },
  completed: { label: 'Completed', color: '#4ade80', bg: 'rgba(74,222,128,0.12)', border: 'rgba(74,222,128,0.35)' },
  stopped:   { label: 'Stopped',   color: '#94a3b8', bg: 'rgba(148,163,184,0.14)', border: 'rgba(148,163,184,0.35)' },
  failed:    { label: 'Failed',    color: '#f87171', bg: 'rgba(248,113,113,0.12)', border: 'rgba(248,113,113,0.35)' },
};

// Compact icon + tone per element tag, so scanning a page's element list is
// mostly shape/color recognition rather than reading "tag": "button" fifty times.
const TAG_META: Record<string, { icon: React.ElementType; color: string }> = {
  button:   { icon: MousePointerClick, color: '#22d3ee' },
  a:        { icon: Link2,            color: '#a5b4fc' },
  input:    { icon: TextCursorInput,  color: '#4ade80' },
  textarea: { icon: TextCursorInput,  color: '#4ade80' },
  select:   { icon: ChevronRight,     color: '#fbbf24' },
  form:     { icon: ClipboardList,    color: '#f472b6' },
};
const tagMeta = (tag: string) => TAG_META[tag] || { icon: MousePointer2, color: '#94a3b8' };

// ─────────────────────────────────────────────────────────────────────────
// Page display names — derived from the URL, not document.title.
//
// Plenty of real sites (SauceDemo included) never change <title> across
// routes — every page is literally "Swag Labs" — so using page.title as the
// list label makes an Explorer with more than one page unreadable: every
// row looks identical and there's no way to tell the inventory page apart
// from three different product-detail pages. Build a name from the URL
// path instead ("Homepage", "Inventory", "Inventory Item"), and when two+
// pages still collapse to the same path label (e.g. three product-detail
// pages that only differ by a ?id= query), disambiguate with the id if one
// exists, or fall back to numbering them in crawl order.
// ─────────────────────────────────────────────────────────────────────────
const _humanizeSegment = (seg: string): string => {
  const noExt = seg.replace(/\.(html?|php|aspx?|jsp)$/i, '');
  const spaced = decodeURIComponent(noExt)
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return spaced
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
};

const _basePathLabel = (rawUrl: string): string => {
  let u: URL;
  try { u = new URL(rawUrl); } catch { return 'Page'; }
  const segments = u.pathname.split('/').filter(Boolean);
  if (segments.length === 0) return 'Homepage';
  const label = segments.map(_humanizeSegment).filter(Boolean).join(' \u203A ');
  return label || 'Homepage';
};

// Query params commonly used as a record identifier — surfaced in the
// disambiguated name ("Inventory Item (4)") in preference to blind
// numbering, since it actually tells you which item this page is.
const _ID_QUERY_KEYS = ['id', 'productid', 'product_id', 'sku', 'itemid', 'item_id'];

const _queryIdHint = (rawUrl: string): string | null => {
  try {
    const u = new URL(rawUrl);
    for (const key of _ID_QUERY_KEYS) {
      const val = u.searchParams.get(key);
      if (val) return val;
    }
  } catch { /* ignore */ }
  return null;
};

const computePageDisplayNames = (pages: any[]): Map<string, string> => {
  const base = pages.map((p: any) => ({ id: p.id, label: _basePathLabel(p.url || ''), idHint: _queryIdHint(p.url || '') }));
  const counts = new Map<string, number>();
  base.forEach((b) => counts.set(b.label, (counts.get(b.label) || 0) + 1));

  const seenOrder = new Map<string, number>();
  const result = new Map<string, string>();
  base.forEach((b) => {
    const total = counts.get(b.label) || 1;
    if (total <= 1) {
      result.set(b.id, b.label);
      return;
    }
    if (b.idHint) {
      result.set(b.id, `${b.label} (${b.idHint})`);
      return;
    }
    const n = (seenOrder.get(b.label) || 0) + 1;
    seenOrder.set(b.label, n);
    result.set(b.id, `${b.label} ${n}`);
  });
  return result;
};

const formatPagesAsText = (pages: any[]): string => {
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

const PageThumb: React.FC<{ path: string | null; alt: string; height?: string }> = ({ path, alt, height = '120px' }) => {
  const [errored, setErrored] = useState(false);
  if (!path || errored) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height, background: '#0b1120', color: '#475569' }}>
        <ImageOff size={20} />
      </div>
    );
  }
  return (
    <img
      src={`${BASE_URL}${path}`}
      alt={alt}
      onError={() => setErrored(true)}
      style={{ width: '100%', height, objectFit: 'cover', objectPosition: 'top', background: '#0b1120' }}
    />
  );
};

// A single attribute row in the expanded detail view — label + value, only
// rendered when the element actually has that field set.
const DetailRow: React.FC<{ label: string; value?: string | null }> = ({ label, value }) => {
  if (!value) return null;
  return (
    <div style={{ display: 'flex', gap: '0.5rem', padding: '3px 0' }}>
      <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#64748b', width: '92px', flexShrink: 0, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{label}</span>
      <span style={{ fontSize: '0.76rem', color: '#cbd5e1', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', wordBreak: 'break-word' }}>{value}</span>
    </div>
  );
};

// A single captured element, shown as a scannable row instead of a JSON blob.
// Collapsed: tag + label + up to 3-4 identifying pills (id, class, and
// type/role — whichever this element actually has) so you can tell what it
// is at a glance without opening anything. Click the row to expand it in
// place and see the rest of what was captured for THIS element specifically
// (role, type, aria-label, placeholder, href, value, data-testid, visible,
// full selector) — a scoped alternative to the page-wide "Edit as JSON"
// view for when you just want to inspect one element, not edit the batch.
const ElementCard: React.FC<{ el: CrawledElement }> = ({ el }) => {
  const [expanded, setExpanded] = useState(false);
  const meta = tagMeta(el.tag);
  const Icon = meta.icon;
  const thirdPill = el.type || el.role || null;
  const thirdPillKind = el.type ? 'type' : el.role ? 'role' : null;

  return (
    <div style={{ background: '#101828', border: '1px solid rgba(148,163,184,0.14)', borderRadius: '8px', overflow: 'hidden' }}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{ width: '100%', display: 'flex', gap: '0.6rem', alignItems: 'flex-start', padding: '0.55rem 0.7rem', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}
      >
        <div style={{ width: '26px', height: '26px', borderRadius: '6px', background: `${meta.color}1a`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: '1px' }}>
          <Icon size={14} style={{ color: meta.color }} />
        </div>
        <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: '3px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.68rem', fontWeight: 800, color: meta.color, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{el.tag}</span>
            <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {el.label || el.name || el.id || '(no label)'}
            </span>
          </div>
          {/* Up to 3 identifying pills by default — id, class, and type/role
              (whichever this element has) — the fields most useful for
              recognizing "which element is this" and for dev/test work. */}
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            {el.id && <span style={{ fontSize: '0.68rem', color: '#a5b4fc', background: 'rgba(129,140,248,0.12)', padding: '1px 6px', borderRadius: '4px', fontFamily: 'monospace' }}>id={el.id}</span>}
            {el.className && <span style={{ fontSize: '0.68rem', color: '#94a3b8', background: 'rgba(148,163,184,0.1)', padding: '1px 6px', borderRadius: '4px', fontFamily: 'monospace', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>class={el.className}</span>}
            {thirdPill && <span style={{ fontSize: '0.68rem', color: '#fbbf24', background: 'rgba(251,191,36,0.1)', padding: '1px 6px', borderRadius: '4px', fontFamily: 'monospace' }}>{thirdPillKind}={thirdPill}</span>}
          </div>
          <span style={{ fontSize: '0.68rem', color: '#64748b', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{el.selector}</span>
        </div>
        <ChevronDown size={14} style={{ color: '#64748b', flexShrink: 0, marginTop: '4px', transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
      </button>

      {expanded && (
        <div style={{ padding: '0.2rem 0.7rem 0.7rem 2.9rem', borderTop: '1px solid rgba(148,163,184,0.1)' }}>
          <DetailRow label="Label" value={el.label} />
          <DetailRow label="Id" value={el.id} />
          <DetailRow label="Class" value={el.className} />
          <DetailRow label="Name" value={(el as any).name} />
          <DetailRow label="Role" value={el.role} />
          <DetailRow label="Type" value={el.type} />
          <DetailRow label="Aria-label" value={(el as any).ariaLabel} />
          <DetailRow label="Placeholder" value={(el as any).placeholder} />
          <DetailRow label="Href" value={(el as any).href} />
          <DetailRow label="Value" value={(el as any).value} />
          <DetailRow label="Data-testid" value={(el as any).dataTestId} />
          <DetailRow label="Selector" value={el.selector} />
          <DetailRow label="Visible" value={(el as any).visible === false ? 'false' : (el as any).visible === true ? 'true' : null} />
          <DetailRow label="Crawl id" value={(el as any).crawlId} />
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────
// Crawl Explorer — dedicated full-screen view: a searchable page list on the
// left, screenshot + element cards for whichever page is selected on the
// right. Opened from the summary card instead of showing every page inline.
// ─────────────────────────────────────────────────────────────────────────
const CrawlExplorer: React.FC<{
  appId: string;
  session: CrawlSession;
  onClose: () => void;
  onSessionRefresh: () => void;
}> = ({ appId, session, onClose, onSessionRefresh }) => {
  const pages = session.pages || [];
  const displayNames = useMemo(() => computePageDisplayNames(pages), [pages]);
  const [query, setQuery] = useState('');
  const [selectedPageId, setSelectedPageId] = useState<string | null>(pages[0]?.id || null);
  const [pageDetail, setPageDetail] = useState<CrawlPage | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [recrawling, setRecrawling] = useState(false);
  const [exportingText, setExportingText] = useState(false);

  const filteredPages = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return pages;
    return pages.filter((p: any) =>
      (p.title || '').toLowerCase().includes(q) ||
      (p.url || '').toLowerCase().includes(q) ||
      (displayNames.get(p.id) || '').toLowerCase().includes(q)
    );
  }, [pages, query, displayNames]);

  const loadPageDetail = async (pageId: string) => {
    setLoadingDetail(true);
    setEditMode(false);
    setJsonError(null);
    try {
      const data = await apiService.getCrawlPage(appId, pageId);
      setPageDetail(data);
      setJsonText(JSON.stringify(data.elements || [], null, 2));
    } catch (err: any) {
      setJsonError(err.message || 'Failed to load page detail.');
    } finally {
      setLoadingDetail(false);
    }
  };

  useEffect(() => {
    if (selectedPageId) loadPageDetail(selectedPageId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPageId]);

  const handleSaveEdits = async () => {
    if (!selectedPageId) return;
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
      const updated = await apiService.updateCrawlPageElements(appId, selectedPageId, parsed);
      setPageDetail(updated);
      setEditMode(false);
      onSessionRefresh();
    } catch (err: any) {
      setJsonError(err.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  const handleRecrawl = async () => {
    if (!selectedPageId) return;
    setRecrawling(true);
    try {
      const updated = await apiService.recrawlPage(appId, selectedPageId);
      setPageDetail(updated);
      setJsonText(JSON.stringify(updated.elements || [], null, 2));
      onSessionRefresh();
    } catch (err: any) {
      setJsonError(err.message || 'Recrawl failed.');
    } finally {
      setRecrawling(false);
    }
  };

  const handleExportJson = () => apiService.exportCrawlSession(appId, session.id);

  const handleExportText = async () => {
    setExportingText(true);
    try {
      const data = await apiService.fetchCrawlSessionExportData(appId, session.id);
      const text = `CRAWL EXPORT — ${data.baseUrl}\n${data.pagesCrawled} page(s), ${data.totalElements} element(s)\n\n${formatPagesAsText(data.pages || [])}`;
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `crawl_${session.id}.txt`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      setJsonError(err.message || 'Text export failed.');
    } finally {
      setExportingText(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(3,7,18,0.82)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }} onClick={onClose}>
      <div
        style={{ background: '#141c30', border: '1px solid rgba(148,163,184,0.2)', borderRadius: '14px', width: '100%', maxWidth: '1240px', height: '86vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.9rem 1.1rem', borderBottom: '1px solid rgba(148,163,184,0.14)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <LayoutGrid size={16} style={{ color: '#22d3ee' }} />
            <span style={{ fontSize: '0.95rem', fontWeight: 700, color: '#f1f5f9' }}>Crawl Explorer</span>
            <span style={{ fontSize: '0.75rem', color: '#64748b' }}>{session.baseUrl} · {pages.length} page(s)</span>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="button" onClick={handleExportJson} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', background: 'rgba(129,140,248,0.12)', border: '1px solid rgba(129,140,248,0.4)', color: '#a5b4fc', fontWeight: 700, fontSize: '0.75rem', borderRadius: '6px', padding: '0.4rem 0.7rem', cursor: 'pointer' }}>
              <FileJson size={12} /> Export JSON
            </button>
            <button type="button" onClick={handleExportText} disabled={exportingText} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.35)', color: '#86efac', fontWeight: 700, fontSize: '0.75rem', borderRadius: '6px', padding: '0.4rem 0.7rem', cursor: exportingText ? 'default' : 'pointer', opacity: exportingText ? 0.6 : 1 }}>
              <FileText size={12} /> {exportingText ? 'Preparing…' : 'Export Text'}
            </button>
            <button type="button" onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', marginLeft: '0.3rem' }}><X size={20} /></button>
          </div>
        </div>

        {/* Body: page list + detail pane */}
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          {/* Page list */}
          <div style={{ width: '280px', flexShrink: 0, borderRight: '1px solid rgba(148,163,184,0.14)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '0.7rem', borderBottom: '1px solid rgba(148,163,184,0.12)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: '#0b1120', border: '1px solid rgba(148,163,184,0.18)', borderRadius: '6px', padding: '0.4rem 0.6rem' }}>
                <Search size={13} style={{ color: '#64748b', flexShrink: 0 }} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filter pages by title or URL…"
                  style={{ background: 'transparent', border: 'none', outline: 'none', color: '#e2e8f0', fontSize: '0.78rem', width: '100%' }}
                />
              </div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '0.4rem' }}>
              {filteredPages.length === 0 && (
                <div style={{ padding: '1rem', textAlign: 'center', fontSize: '0.78rem', color: '#64748b' }}>No pages match "{query}".</div>
              )}
              {filteredPages.map((p: any) => {
                const isActive = p.id === selectedPageId;
                const name = displayNames.get(p.id) || p.title || 'Untitled';
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedPageId(p.id)}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: '0.5rem', textAlign: 'left',
                      background: isActive ? 'rgba(34,211,238,0.1)' : 'transparent',
                      border: `1px solid ${isActive ? 'rgba(34,211,238,0.4)' : 'transparent'}`,
                      borderRadius: '8px', padding: '0.45rem 0.5rem', cursor: 'pointer', marginBottom: '2px',
                    }}
                  >
                    <div style={{ width: '38px', height: '30px', borderRadius: '4px', overflow: 'hidden', flexShrink: 0 }}>
                      <PageThumb path={p.screenshotPath} alt={name} height="30px" />
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: '0.78rem', fontWeight: 600, color: isActive ? '#e2e8f0' : '#cbd5e1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                      <div style={{ fontSize: '0.66rem', color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.elementCount} elements{p.status === 'failed' ? ' · failed' : ''}</div>
                    </div>
                    {p.status === 'failed' && <AlertTriangle size={12} style={{ color: '#f87171', flexShrink: 0 }} />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Detail pane */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '1.1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {loadingDetail && <div style={{ margin: 'auto', color: '#94a3b8', fontSize: '0.85rem' }}>Loading page…</div>}
            {!loadingDetail && pageDetail && (
              <>
                <div>
                  <div style={{ fontSize: '1rem', fontWeight: 700, color: '#f1f5f9' }}>
                    {(selectedPageId && displayNames.get(selectedPageId)) || pageDetail.title || 'Untitled Page'}
                  </div>
                  {selectedPageId && pageDetail.title && displayNames.get(selectedPageId) && displayNames.get(selectedPageId) !== pageDetail.title && (
                    <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '1px' }}>Page title: {pageDetail.title}</div>
                  )}
                  <a href={pageDetail.url} target="_blank" rel="noreferrer" style={{ fontSize: '0.75rem', color: '#818cf8', display: 'inline-flex', alignItems: 'center', gap: '4px', textDecoration: 'none', marginTop: '2px' }}>
                    {pageDetail.url} <ExternalLink size={11} />
                  </a>
                </div>

                {pageDetail.screenshotPath ? (
                  <img src={`${BASE_URL}${pageDetail.screenshotPath}`} alt={pageDetail.title || pageDetail.url} style={{ width: '100%', maxWidth: '520px', borderRadius: '8px', border: '1px solid rgba(148,163,184,0.18)' }} />
                ) : (
                  <div style={{ width: '100%', maxWidth: '520px', height: '180px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0b1120', borderRadius: '8px', color: '#475569' }}>
                    <ImageOff size={24} />
                  </div>
                )}

                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button type="button" onClick={handleRecrawl} disabled={recrawling} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', background: 'rgba(129,140,248,0.12)', border: '1px solid rgba(129,140,248,0.4)', color: '#a5b4fc', fontWeight: 700, fontSize: '0.75rem', borderRadius: '6px', padding: '0.4rem 0.7rem', cursor: recrawling ? 'default' : 'pointer', opacity: recrawling ? 0.6 : 1 }}>
                    <RefreshCw size={12} className={recrawling ? 'spin' : ''} /> {recrawling ? 'Recrawling…' : 'Recrawl'}
                  </button>
                  <button type="button" onClick={() => setEditMode(m => !m)} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', background: editMode ? 'rgba(34,211,238,0.14)' : 'rgba(148,163,184,0.1)', border: `1px solid ${editMode ? 'rgba(34,211,238,0.4)' : 'rgba(148,163,184,0.22)'}`, color: editMode ? '#67e8f9' : '#94a3b8', fontWeight: 700, fontSize: '0.75rem', borderRadius: '6px', padding: '0.4rem 0.7rem', cursor: 'pointer' }}>
                    <Code2 size={12} /> {editMode ? 'Back to Card View' : 'Edit as JSON'}
                  </button>
                </div>

                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.6rem' }}>
                    <Layers size={13} style={{ color: '#818cf8' }} />
                    <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Captured Elements ({pageDetail.elementCount})
                    </span>
                    {pageDetail.editedAt && <span style={{ fontSize: '0.68rem', color: '#4ade80' }}>· edited {new Date(pageDetail.editedAt).toLocaleString()}</span>}
                  </div>

                  {editMode ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <textarea
                        value={jsonText}
                        onChange={(e) => setJsonText(e.target.value)}
                        spellCheck={false}
                        style={{
                          minHeight: '320px', width: '100%', padding: '0.75rem', borderRadius: '8px',
                          border: `1px solid ${jsonError ? 'rgba(248,113,113,0.5)' : 'rgba(148,163,184,0.22)'}`,
                          background: '#0b1120', color: '#cbd5e1', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                          fontSize: '0.78rem', outline: 'none', resize: 'vertical',
                        }}
                      />
                      {jsonError && <span style={{ fontSize: '0.75rem', color: '#f87171' }}>{jsonError}</span>}
                      <button type="button" onClick={handleSaveEdits} disabled={saving} style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: '0.4rem', background: '#22d3ee', border: 'none', color: '#05070d', fontWeight: 700, fontSize: '0.8rem', borderRadius: '6px', padding: '0.5rem 0.9rem', cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.7 : 1 }}>
                        <Save size={13} /> {saving ? 'Saving…' : 'Save Edits'}
                      </button>
                      <span style={{ fontSize: '0.7rem', color: '#64748b' }}>Full raw JSON — use this to fix a selector or add an element the crawler missed.</span>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                      {(pageDetail.elements || []).length === 0 ? (
                        <div style={{ padding: '1rem', textAlign: 'center', color: '#64748b', fontSize: '0.8rem', background: '#101828', borderRadius: '8px' }}>No elements captured on this page.</div>
                      ) : (
                        (pageDetail.elements || []).map((el, idx) => <ElementCard key={el.crawlId || idx} el={el} />)
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
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
  const [showExplorer, setShowExplorer] = useState(false);
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

  useEffect(() => {
    setSession(null);
    setSessions([]);
    setSelectedSessionId(null);
    setError(null);
    setShowExplorer(false);
    if (activeAppId) loadSessions(true);
  }, [activeAppId]);

  useEffect(() => {
    if (selectedSessionId) loadSession(selectedSessionId);
  }, [selectedSessionId]);

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

  const isRunning = session?.status === 'running';
  const meta = session ? statusMeta[session.status] : null;
  const failedCount = (session?.pages || []).filter(p => p.status === 'failed').length;

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
            <button type="button" onClick={handleStop} disabled={stopping} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.4)', color: '#fca5a5', fontWeight: 700, fontSize: '0.85rem', borderRadius: '8px', padding: '0.55rem 0.9rem', cursor: stopping ? 'default' : 'pointer', opacity: stopping ? 0.6 : 1 }}>
              <Square size={14} /> {stopping ? 'Stopping…' : 'Stop Crawl'}
            </button>
          ) : (
            <button type="button" onClick={handleStart} disabled={!activeAppId || starting} title={!activeAppId ? 'Select an application first' : 'Crawl the entire application'} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: '#22d3ee', border: 'none', color: '#05070d', fontWeight: 700, fontSize: '0.85rem', borderRadius: '8px', padding: '0.55rem 0.9rem', cursor: (!activeAppId || starting) ? 'default' : 'pointer', opacity: (!activeAppId || starting) ? 0.5 : 1 }}>
              <Play size={14} /> {starting ? 'Starting…' : 'Start Full Crawl'}
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

      {/* ── Crawl Batch summary — replaces the old flat page-card grid.
          Click it (or "View Crawled Pages") to open the Explorer. ── */}
      {session && (
        <div
          onClick={() => (session.pages || []).length > 0 && setShowExplorer(true)}
          style={{
            background: '#141c30', border: '1px solid rgba(148,163,184,0.18)', borderRadius: '12px', padding: '1.25rem',
            cursor: (session.pages || []).length > 0 ? 'pointer' : 'default', display: 'flex', flexDirection: 'column', gap: '1rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              {meta && (
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', background: meta.bg, border: `1px solid ${meta.border}`, color: meta.color, fontWeight: 700, fontSize: '0.72rem', borderRadius: '999px', padding: '0.25rem 0.65rem' }}>
                  {isRunning ? <RefreshCw size={11} className="spin" /> : session.status === 'completed' ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} />}
                  {meta.label}
                </span>
              )}
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#f1f5f9' }}>Crawl Batch</span>
              <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>{session.baseUrl}</span>
            </div>
            {session.durationSec != null && (
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem', color: '#94a3b8' }}>
                <Clock size={12} /> {session.durationSec}s
              </span>
            )}
          </div>

          {session.errorMessage && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.35)', color: '#fca5a5', padding: '0.7rem 0.85rem', borderRadius: '8px', fontSize: '0.78rem' }}>
              <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: '1px' }} />
              <span>{session.errorMessage}</span>
            </div>
          )}

          {session.authAttempted && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 0.85rem', borderRadius: '8px', fontSize: '0.78rem',
              background: session.authSucceeded ? 'rgba(74,222,128,0.12)' : 'rgba(251,191,36,0.12)',
              border: `1px solid ${session.authSucceeded ? 'rgba(74,222,128,0.35)' : 'rgba(251,191,36,0.5)'}`,
              color: session.authSucceeded ? '#4ade80' : '#fbbf24',
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
              <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#f1f5f9', marginTop: '2px' }}>{failedCount}</div>
            </div>
          </div>

          {(session.pages || []).length > 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '0.25rem' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.78rem', color: '#94a3b8' }}>
                <MousePointerClick size={13} style={{ color: '#818cf8' }} /> Click to review, edit, or export what this crawl captured.
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', background: 'rgba(34,211,238,0.12)', border: '1px solid rgba(34,211,238,0.4)', color: '#67e8f9', fontWeight: 700, fontSize: '0.78rem', borderRadius: '6px', padding: '0.45rem 0.85rem' }}>
                <LayoutGrid size={13} /> View Crawled Pages ({session.pages!.length})
              </span>
            </div>
          ) : (
            isRunning && <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Crawling — pages will appear here as they're discovered…</span>
          )}
        </div>
      )}

      {showExplorer && session && activeAppId && (
        <CrawlExplorer
          appId={activeAppId}
          session={session}
          onClose={() => setShowExplorer(false)}
          onSessionRefresh={() => { if (selectedSessionId) loadSession(selectedSessionId); }}
        />
      )}
    </div>
  );
};