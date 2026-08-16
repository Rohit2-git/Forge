import React, { useRef, useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import {
  LayoutDashboard,
  Database,
  ClipboardCheck,
  UserCog,
  Plus,
  Layers,
  Globe,
  Smartphone,
  Server,
  X,
  ChevronsLeft,
  ChevronsRight,
  ChevronDown,
  LogOut
} from 'lucide-react';
import { ForgeLogo } from './ForgeLogo';
import { useAuth } from '../context/AuthContext';

// This sidebar merges two things:
//  1. The truncation bugfix from the other tool's Sidebar.tsx — the app-name
//     text now lives in a real <button> with `minWidth: 0` applied at every
//     level of the flex chain (outer container -> button -> inner span), so
//     long application names actually ellipsis instead of overflowing. The
//     old version lost this because `minWidth: 0` was only set on the
//     innermost span; a flex item's default `min-width: auto` means it won't
//     shrink below its children's natural width no matter what the innermost
//     element says, so the fix has to apply at every level.
//  2. A trimmed nav for this generation-only build — no roles, no login, no
//     Execution Lab / Knowledge Space / Token & Cost / Admin Console.

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  isCollapsed,
  onToggleCollapse
}) => {
  const {
    applications,
    activeAppId,
    setActiveAppId,
    addApplication,
    isGenerationRunning
  } = useApp();

  const { user, logout } = useAuth();

  const dialogRef = useRef<HTMLDialogElement>(null);
  const [newAppName, setNewAppName] = useState('');
  const [newAppDesc, setNewAppDesc] = useState('');
  const [newAppPlatform, setNewAppPlatform] = useState<'web' | 'mobile' | 'api'>('web');
  const [newAppUrl, setNewAppUrl] = useState('');

  const [isAppMenuOpen, setIsAppMenuOpen] = useState(false);
  const [hoveredAppId, setHoveredAppId] = useState<string | null>(null);
  const appMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isAppMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (appMenuRef.current && !appMenuRef.current.contains(e.target as Node)) {
        setIsAppMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isAppMenuOpen]);

  const activeApp = applications.find(app => app.id === activeAppId);
  const isSystemBusy = isGenerationRunning;

  const handleOpenDialog = () => {
    setNewAppName('');
    setNewAppDesc('');
    setNewAppPlatform('web');
    setNewAppUrl('');
    dialogRef.current?.showModal();
  };

  const handleCloseDialog = () => {
    dialogRef.current?.close();
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target === dialogRef.current) {
      handleCloseDialog();
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAppName.trim()) return;

    const created = addApplication({
      name: newAppName,
      description: newAppDesc,
      platform: newAppPlatform,
      url: newAppUrl || 'http://localhost',
      status: 'active'
    });

    handleCloseDialog();
    setActiveAppId(created.id);
  };

  // Open access, no roles — every visitor sees the same four sections.
  const navigationItems = [
    { id: 'dashboard', name: 'Overview', icon: LayoutDashboard },
    { id: 'repository', name: 'Test Cases', icon: Database },
    { id: 'generator', name: 'AI Test Design', icon: ClipboardCheck },
    { id: 'test-data', name: 'Test Data', icon: UserCog },
  ];

  const getPlatformIcon = (platform: 'web' | 'mobile' | 'api') => {
    switch (platform) {
      case 'web': return <Globe size={14} className="platform-icon-cyan" />;
      case 'mobile': return <Smartphone size={14} className="platform-icon-pink" />;
      case 'api': return <Server size={14} className="platform-icon-purple" />;
    }
  };

  return (
    <aside className={`sidebar-container ${isCollapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-brand">
        <div className="brand-logo" aria-hidden="true">
          <ForgeLogo size={22} className="logo-icon-glow" />
        </div>
        {!isCollapsed && (
          <div className="brand-meta">
            <span className="brand-name">Forge</span>
            <span className="brand-subtitle">AI TEST CASE GENERATION</span>
          </div>
        )}
        <button
          type="button"
          className="sidebar-collapse-btn"
          onClick={onToggleCollapse}
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {isCollapsed ? <ChevronsRight size={14} /> : <ChevronsLeft size={14} />}
        </button>
      </div>

      <div className="app-selector-section">
        <label className="selector-label">Target Application</label>
        <div className="selector-dropdown-wrapper">
          <div
            className="app-select-container"
            ref={appMenuRef}
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '10px 12px',
              borderRadius: '10px',
              border: '1px solid rgba(148, 163, 184, 0.25)',
              background: 'rgba(15, 23, 42, 0.35)',
              // This container is itself a flex item inside
              // .selector-dropdown-wrapper (alongside the "+" button). A flex
              // item's default min-width:auto means it won't shrink below its
              // children's natural content width, so truncation never
              // triggers unless min-width:0 is set at every level of the
              // chain down to the text span — not just the innermost one.
              minWidth: 0,
              flex: '1 1 auto',
            }}
          >
            <Layers size={16} style={{ flexShrink: 0, color: '#94a3b8' }} />
            <button
              type="button"
              onClick={() => setIsAppMenuOpen(prev => !prev)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                flex: '1 1 auto', minWidth: 0, cursor: 'pointer', textAlign: 'left', background: 'transparent', overflow: 'hidden',
                border: 'none', outline: 'none', margin: 0, padding: 0,
                color: '#e2e8f0', fontSize: '0.95rem', fontWeight: 700, lineHeight: 1.3, fontFamily: 'inherit',
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: '1 1 auto' }}>
                {activeApp ? `${activeApp.name} (${activeApp.platform.toUpperCase()})` : (applications.length === 0 ? 'No applications' : 'Select application')}
              </span>
              <ChevronDown size={14} style={{ flexShrink: 0, marginLeft: '6px', color: '#94a3b8', transform: isAppMenuOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }} />
            </button>

            {isAppMenuOpen && (
              <div
                role="listbox"
                style={{
                  position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
                  background: '#141c30', border: '1px solid rgba(148,163,184,0.18)', borderRadius: '10px',
                  boxShadow: '0 10px 25px rgba(0,0,0,0.4)', zIndex: 100, overflow: 'hidden',
                  maxHeight: '260px', overflowY: 'auto',
                }}
              >
                {applications.length === 0 ? (
                  <div style={{ padding: '10px 14px', fontSize: '0.85rem', color: '#94a3b8' }}>No applications</div>
                ) : (
                  applications.map(app => (
                    <div
                      key={app.id}
                      role="option"
                      aria-selected={app.id === activeAppId}
                      className="app-option-item"
                      onClick={() => { setActiveAppId(app.id); setIsAppMenuOpen(false); setHoveredAppId(null); }}
                      onMouseEnter={() => setHoveredAppId(app.id)}
                      onMouseLeave={() => setHoveredAppId(null)}
                      style={{
                        padding: '9px 14px', fontSize: '0.85rem', cursor: 'pointer',
                        color: hoveredAppId === app.id ? '#0b1120' : (app.id === activeAppId ? '#67e8f9' : '#e2e8f0'),
                        background: hoveredAppId === app.id ? '#22d3ee' : (app.id === activeAppId ? 'rgba(34,211,238,0.12)' : 'transparent'),
                        fontWeight: app.id === activeAppId ? 700 : 500,
                        transition: 'background 0.1s ease, color 0.1s ease',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}
                      title={`${app.name} (${app.platform.toUpperCase()})`}
                    >
                      {app.name} ({app.platform.toUpperCase()})
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          <button
            type="button"
            className="btn btn-secondary btn-icon-only"
            onClick={handleOpenDialog}
            title="Create New Application"
            aria-label="Create New Application"
          >
            <Plus size={16} />
          </button>
        </div>

        {activeApp && (
          <div className="active-app-badge-details">
            <span className="platform-indicator">
              {getPlatformIcon(activeApp.platform)}
              {activeApp.platform.toUpperCase()}
            </span>
            <span className="environment-url" title={activeApp.url}>{activeApp.url}</span>
          </div>
        )}
      </div>

      <nav className="sidebar-nav">
        <ul>
          {navigationItems.map(item => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`nav-button ${isActive ? 'active' : ''}`}
                  title={item.name}
                >
                  <Icon size={18} className="nav-icon" />
                  <span>{item.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="sidebar-footer" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '1rem 1.5rem', background: 'transparent' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            className="agent-status-pulse"
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: isSystemBusy ? '#f59e0b' : '#10b981',
              boxShadow: isSystemBusy ? '0 0 10px #f59e0b' : '0 0 10px #10b981',
              animation: 'pulse 2s infinite',
              transition: 'background 0.3s ease, box-shadow 0.3s ease'
            }}
          ></span>
          <span
            className="agent-status-text"
            style={{
              fontSize: '0.8rem',
              fontWeight: 700,
              color: isSystemBusy ? '#f59e0b' : '#94a3b8',
              transition: 'color 0.3s ease'
            }}
          >
            {isSystemBusy ? 'Forge (Generating...)' : 'Forge (Idle)'}
          </span>
        </div>

        {!isCollapsed && user && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
            <span style={{ fontSize: '0.78rem', color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }} title={user.email}>
              {user.name || user.email}
            </span>
            <button
              type="button"
              onClick={logout}
              title="Log out"
              aria-label="Log out"
              style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '4px', background: 'transparent', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600, padding: '2px 4px' }}
            >
              <LogOut size={13} /> Log out
            </button>
          </div>
        )}
      </div>

      <dialog
        ref={dialogRef}
        onClick={handleBackdropClick}
        aria-labelledby="modal-title"
      >
        <div className="modal-header">
          <h2 id="modal-title">New Application</h2>
          <button
            type="button"
            className="modal-close-btn"
            onClick={handleCloseDialog}
            aria-label="Close dialog"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-form">
          <div className="form-group">
            <label htmlFor="app-name" className="form-label">Application Name</label>
            <input
              type="text"
              id="app-name"
              className="input-field"
              placeholder="e.g. SwiftCart E-Commerce"
              value={newAppName}
              onChange={(e) => setNewAppName(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className="form-group">
            <label htmlFor="app-desc" className="form-label">Description</label>
            <textarea
              id="app-desc"
              className="textarea-field"
              placeholder="Provide details about the platform features, APIs, and key pages..."
              value={newAppDesc}
              onChange={(e) => setNewAppDesc(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label htmlFor="app-platform" className="form-label">Platform Type</label>
            <select
              id="app-platform"
              className="select-field"
              value={newAppPlatform}
              onChange={(e) => setNewAppPlatform(e.target.value as 'web' | 'mobile' | 'api')}
            >
              <option value="web">Web App</option>
              <option value="mobile">Mobile App</option>
              <option value="api">API Endpoint Suite</option>
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="app-url" className="form-label">Environment URL</label>
            <input
              type="url"
              id="app-url"
              className="input-field"
              placeholder="https://example.com"
              value={newAppUrl}
              onChange={(e) => setNewAppUrl(e.target.value)}
            />
          </div>

          <div className="modal-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleCloseDialog}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
            >
              Create Application
            </button>
          </div>
        </form>
      </dialog>
    </aside>
  );
};
