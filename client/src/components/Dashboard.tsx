import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { 
  Folder, 
  FileCheck, 
  Activity,
  Layers,
  ArrowRight,
  BookOpen,
  Bot,
  PenSquare,
  Loader2,
  Settings2,
  X,
  Check,
  Trash2
} from 'lucide-react';

interface DashboardProps {
  setActiveTab: (tab: string) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ setActiveTab }) => {
  const {
    applications,
    testCases,
    history,
    knowledgeAssets,
    activeAppId,
    setActiveAppId,
    updateApplication,
    deleteApplication
  } = useApp();

  // ⚡ DYNAMIC CLIENT DERIVATIONS - ALWAYS 100% IN SYNC WITH CURRENT APP WORKSPACE
  const totalApps = applications.length;
  const totalTestCases = testCases.length;
  const aiGeneratedTests = testCases.filter(tc => tc.source === 'ai-jira' || tc.source === 'ai-acceptance').length;
  const manualAuthoredTests = testCases.filter(tc => tc.source === 'manual' || !tc.source).length;
  const totalKnowledgeAssets = knowledgeAssets?.length || 0;

  // Derive running jobs cleanly by inspecting active execution histories dynamically
  const runningJobs = history.filter(run => run.status === 'running').length;

  // Calculate the live success rating mathematically based on completed executions
  const overallPassRate = useMemo(() => {
    const completedRuns = history.filter(run => run.status === 'passed' || run.status === 'failed');
    if (completedRuns.length === 0) return 100; // Default baseline index
    const passedRuns = completedRuns.filter(run => run.status === 'passed').length;
    return Math.round((passedRuns / completedRuns.length) * 100);
  }, [history]);

  const [loading] = useState(false);
  const [isManageModalOpen, setIsManageModalOpen] = useState(false);
  const [editingAppId, setEditingAppId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');

  const handleSelectApp = (appId: string) => {
    setActiveAppId(appId);
    setActiveTab('repository');
  };

  const getAppName = (appId: string) => {
    const app = applications.find(a => a.id === appId);
    return app ? app.name : 'Unknown Application';
  };

  const getAppTestCount = (appId: string) => {
    return testCases.filter(tc => tc.appId === appId).length;
  };

  const getAppPassRate = (appId: string) => {
    const appRuns = history.filter(r => r.appId === appId && r.status !== 'running');
    if (appRuns.length === 0) return 'N/A';
    const passed = appRuns.filter(r => r.status === 'passed').length;
    return `${Math.round((passed / appRuns.length) * 100)}%`;
  };

  const formatDate = (isoString: string) => {
    if (!isoString) return "N/A";
    const d = new Date(isoString);
    return d.toLocaleDateString(undefined, { 
      month: 'short', 
      day: 'numeric', 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  const startEditing = (app: any, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingAppId(app.id);
    setEditName(app.name);
    setEditDesc(app.description || '');
  };

  const saveAppEdits = (app: any, e: React.MouseEvent) => {
    e.stopPropagation();
    updateApplication({
      ...app,
      name: editName,
      description: editDesc
    });
    setEditingAppId(null);
  };

  const handleDeleteAppClick = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm("Are you absolutely sure you want to delete this target environment profile? This permanently purges all linked blueprints!")) {
      deleteApplication(id);
    }
  };

  return (
    <div className="dashboard-view" style={{ fontFamily: 'system-ui, -apple-system, sans-serif', padding: '2rem', background: 'linear-gradient(135deg, #101828 0%, #1a2338 100%)', minHeight: '100vh' }}>
      
      {/* HEADER SECTION */}
      <div className="view-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2.5rem' }}>
        <div>
          <h1 style={{ fontSize: '2.25rem', fontWeight: 900, color: '#f1f5f9', letterSpacing: '-0.04em' }}>Quality Operations Hub</h1>
          <p style={{ color: '#94a3b8', marginTop: '0.4rem', fontSize: '1.05rem', fontWeight: 500 }}>Monitor cross-platform test coverage, AI generation metrics, and system runtime execution reliability.</p>
        </div>
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#22d3ee', fontSize: '0.9rem', fontWeight: 600, background: '#141c30', padding: '8px 16px', borderRadius: '30px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
            <Loader2 className="animate-spin" size={16} />
            <span>Telemetry Refreshing...</span>
          </div>
        )}
      </div>

      {/* STATS TILES GLASS GRID - ROW 1 */}
      <div className="dashboard-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1.5rem', marginBottom: '1.5rem' }}>
        <div style={{ background: 'rgba(30,41,59,0.45)', backdropFilter: 'blur(12px)', border: '1px solid rgba(148,163,184,0.14)', borderRadius: '20px', padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1.25rem', boxShadow: '0 10px 15px -3px rgba(15, 23, 42, 0.04)' }}>
          <div style={{ background: 'rgba(192,132,252,0.14)', color: '#a855f7', padding: '12px', borderRadius: '12px' }}><Layers size={24} /></div>
          <div>
            <span style={{ display: 'block', fontSize: '1.85rem', fontWeight: 800, color: '#f1f5f9', lineHeight: '1.2' }}>{totalApps}</span>
            <span style={{ fontSize: '0.85rem', color: '#94a3b8', fontWeight: 600 }}>Registered Applications</span>
          </div>
        </div>

        <div style={{ background: 'rgba(30,41,59,0.45)', backdropFilter: 'blur(12px)', border: '1px solid rgba(148,163,184,0.14)', borderRadius: '20px', padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1.25rem', boxShadow: '0 10px 15px -3px rgba(15, 23, 42, 0.04)' }}>
          <div style={{ background: 'rgba(34,211,238,0.12)', color: '#22d3ee', padding: '12px', borderRadius: '12px' }}><Folder size={24} /></div>
          <div>
            <span style={{ display: 'block', fontSize: '1.85rem', fontWeight: 800, color: '#f1f5f9', lineHeight: '1.2' }}>{totalTestCases}</span>
            <span style={{ fontSize: '0.85rem', color: '#94a3b8', fontWeight: 600 }}>Total Test Suite Size</span>
          </div>
        </div>

        <div style={{ background: 'rgba(30,41,59,0.45)', backdropFilter: 'blur(12px)', border: '1px solid rgba(148,163,184,0.14)', borderRadius: '20px', padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1.25rem', boxShadow: '0 10px 15px -3px rgba(15, 23, 42, 0.04)' }}>
          <div style={{ background: 'rgba(74,222,128,0.12)', color: '#16a34a', padding: '12px', borderRadius: '12px' }}><FileCheck size={24} /></div>
          <div>
            <span style={{ display: 'block', fontSize: '1.85rem', fontWeight: 800, color: '#f1f5f9', lineHeight: '1.2' }}>{overallPassRate}%</span>
            <span style={{ fontSize: '0.85rem', color: '#94a3b8', fontWeight: 600 }}>Average Success Rate</span>
          </div>
        </div>

        <div style={{ background: 'rgba(30,41,59,0.45)', backdropFilter: 'blur(12px)', border: '1px solid rgba(148,163,184,0.14)', borderRadius: '20px', padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1.25rem', boxShadow: '0 10px 15px -3px rgba(15, 23, 42, 0.04)' }}>
          <div style={{ background: 'rgba(251,191,36,0.12)', color: '#d97706', padding: '12px', borderRadius: '12px' }}><Activity size={24} /></div>
          <div>
            <span style={{ display: 'block', fontSize: '1.85rem', fontWeight: 800, color: '#f1f5f9', lineHeight: '1.2' }}>{runningJobs}</span>
            <span style={{ fontSize: '0.85rem', color: '#94a3b8', fontWeight: 600 }}>Running Agents</span>
          </div>
        </div>
      </div>

      {/* SUB GRID CARD METRICS ROW 2 */}
      <div className="dashboard-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1.5rem', marginBottom: '2.5rem' }}>
        <div style={{ background: 'rgba(30,41,59,0.45)', backdropFilter: 'blur(12px)', border: '1px solid rgba(148,163,184,0.14)', borderRadius: '20px', padding: '1.25rem', display: 'flex', alignItems: 'center', gap: '1rem', boxShadow: '0 10px 15px -3px rgba(15, 23, 42, 0.04)' }}>
          <div style={{ background: 'rgba(96,165,250,0.14)', color: '#3b82f6', padding: '10px', borderRadius: '10px' }}><PenSquare size={20} /></div>
          <div>
            <span style={{ display: 'block', fontSize: '1.5rem', fontWeight: 800, color: '#f1f5f9' }}>{manualAuthoredTests}</span>
            <span style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 500 }}>Manual Authored</span>
          </div>
        </div>

        <div style={{ background: 'rgba(30,41,59,0.45)', backdropFilter: 'blur(12px)', border: '1px solid rgba(148,163,184,0.14)', borderRadius: '20px', padding: '1.25rem', display: 'flex', alignItems: 'center', gap: '1rem', boxShadow: '0 10px 15px -3px rgba(15, 23, 42, 0.04)' }}>
          <div style={{ background: 'rgba(34,211,238,0.12)', color: '#22d3ee', padding: '10px', borderRadius: '10px' }}><Bot size={20} /></div>
          <div>
            <span style={{ display: 'block', fontSize: '1.5rem', fontWeight: 800, color: '#f1f5f9' }}>{aiGeneratedTests}</span>
            <span style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 500 }}>AI Generated</span>
          </div>
        </div>

        <div style={{ background: 'rgba(30,41,59,0.45)', backdropFilter: 'blur(12px)', border: '1px solid rgba(148,163,184,0.14)', borderRadius: '20px', padding: '1.25rem', display: 'flex', alignItems: 'center', gap: '1rem', boxShadow: '0 10px 15px -3px rgba(15, 23, 42, 0.04)' }}>
          <div style={{ background: 'rgba(192,132,252,0.12)', color: '#7c3aed', padding: '10px', borderRadius: '10px' }}><BookOpen size={20} /></div>
          <div>
            <span style={{ display: 'block', fontSize: '1.5rem', fontWeight: 800, color: '#f1f5f9' }}>{totalKnowledgeAssets}</span>
            <span style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 500 }}>Grounding Contexts</span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setActiveTab('generator')}
          style={{ background: 'linear-gradient(135deg, #22d3ee, #818cf8)', color: '#0b1120', border: 'none', borderRadius: '20px', padding: '1.25rem', fontWeight: 700, fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', cursor: 'pointer', boxShadow: '0 10px 20px -5px rgba(34,211,238,0.35)', transition: 'transform 0.15s, box-shadow 0.15s' }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 14px 24px -5px rgba(34,211,238,0.45)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 10px 20px -5px rgba(34,211,238,0.35)'; }}
        >
          <Bot size={16} />
          <span>Generate Test Cases</span>
        </button>
      </div>

      {/* OPTIMIZED MASTER COLUMN LAYOUT SPLIT (62% Ecosystems vs 38% Telemetry Module) */}
      <div style={{ display: 'grid', gridTemplateColumns: '62% 38%', gap: '2rem', alignItems: 'start' }}>
        
        {/* WORKSPACE APP GRIDS */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
            <h2 style={{ fontSize: '1.35rem', fontWeight: 800, color: '#f1f5f9', letterSpacing: '-0.01em' }}>Target Verification Ecosystems</h2>
            <button 
              onClick={() => setIsManageModalOpen(true)}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: '#141c30', border: '1px solid #94a3b8', color: '#cbd5e1', padding: '8px 14px', borderRadius: '10px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}
            >
              <Settings2 size={14} />
              <span>Configure Environments</span>
            </button>
          </div>
          
          {applications.length === 0 ? (
            <div style={{ background: '#141c30', textAlign: 'center', padding: '4rem', borderRadius: '24px', border: '1px solid rgba(148,163,184,0.18)' }}>
              <p style={{ color: '#94a3b8', fontWeight: 500 }}>No environment configurations found. Select the sidebar "+" node to deploy.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
              {applications.map(app => {
                const isActive = app.id === activeAppId;
                return (
                  <div 
                    key={app.id} 
                    onClick={() => handleSelectApp(app.id)}
                    style={{ background: '#141c30', border: isActive ? '2px solid #22d3ee' : '1px solid rgba(148,163,184,0.18)', boxShadow: isActive ? '0 12px 20px -3px rgba(6,182,212,0.12)' : '0 4px 6px -1px rgba(0,0,0,0.02)', borderRadius: '20px', padding: '1.25rem', cursor: 'pointer', position: 'relative' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <strong style={{ fontSize: '1rem', color: '#f1f5f9', fontWeight: 700 }}>{app.name}</strong>
                      <span style={{ fontSize: '0.65rem', fontWeight: 700, background: app.platform === 'web' ? 'rgba(34,211,238,0.12)' : 'rgba(192,132,252,0.12)', color: app.platform === 'web' ? '#0891b2' : '#7c3aed', padding: '4px 8px', borderRadius: '6px', textTransform: 'uppercase' }}>
                        {app.platform}
                      </span>
                    </div>
                    <p style={{ fontSize: '0.85rem', color: '#94a3b8', lineHeight: '1.5', minHeight: '4.5em', margin: '0 0 1rem 0' }}>
                      {app.description || "Active cross-platform verification framework layout profile target assignment."}
                    </p>
                    
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '0.75rem', borderTop: '1px solid #1a2338', fontSize: '0.78rem', color: '#94a3b8', fontWeight: 500 }}>
                      <span>{getAppTestCount(app.id)} Active Blueprints</span>
                      <span>Pass Index: <strong style={{ color: '#f1f5f9', fontWeight: 700 }}>{getAppPassRate(app.id)}</strong></span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* TELEMETRY STREAM PANEL */}
        <div>
          <h2 style={{ fontSize: '1.35rem', fontWeight: 800, color: '#f1f5f9', marginBottom: '1.25rem', letterSpacing: '-0.01em' }}>Telemetry Stream</h2>
          <div style={{ background: '#141c30', border: '1px solid rgba(148,163,184,0.18)', borderRadius: '24px', padding: '1.25rem', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.02)', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {history.length === 0 ? (
              <p style={{ textAlign: 'center', padding: '3.5rem 0', color: '#94a3b8', fontSize: '0.9rem', fontWeight: 500 }}>No automation logs stored.</p>
            ) : (
              history.slice(0, 4).map(run => (
                <div key={run.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', paddingBottom: '1rem', borderBottom: '1px solid #1a2338' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.9rem', color: '#f1f5f9' }}>{getAppName(run.appId)}</span>
                    <span style={{ fontSize: '0.65rem', fontWeight: 800, textTransform: 'uppercase', background: run.status === 'passed' ? 'rgba(74,222,128,0.14)' : 'rgba(248,113,113,0.14)', color: run.status === 'passed' ? '#15803d' : '#fca5a5', padding: '2px 8px', borderRadius: '6px' }}>
                      {run.status}
                    </span>
                  </div>
                  {run.nlInstruction && (
                    <span style={{ fontSize: '0.75rem', color: '#cbd5e1', background: '#101828', padding: '4px 8px', borderRadius: '6px', border: '1px solid rgba(148,163,184,0.18)', fontFamily: 'monospace', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                      "{run.nlInstruction}"
                    </span>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#94a3b8', fontWeight: 500 }}>
                    <span>{run.metrics?.stepsCount || 0} operations • {((run.metrics?.durationMs || 0) / 1000).toFixed(1)}s</span>
                    <span>{formatDate(run.executedAt)}</span>
                  </div>
                </div>
              ))
            )}
            <button 
              type="button" 
              onClick={() => setActiveTab('repository')} 
              style={{ width: '100%', height: '38px', borderRadius: '10px', background: '#1a2338', border: '1px solid rgba(148,163,184,0.18)', color: '#e2e8f0', fontSize: '0.85rem', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', cursor: 'pointer', transition: 'background 0.2s' }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(148,163,184,0.18)'}
              onMouseLeave={(e) => e.currentTarget.style.background = '#1a2338'}
            >
              <span>Open Test Cases</span>
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* CONFIGURATION OVERLAY MODAL */}
      {isManageModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(15, 23, 42, 0.3)', backdropFilter: 'blur(6px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
          <div style={{ background: '#141c30', width: '580px', borderRadius: '24px', padding: '1.75rem', border: '1px solid rgba(148,163,184,0.18)', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.15)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #1a2338', paddingBottom: '1rem', marginBottom: '1.25rem' }}>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#f1f5f9', letterSpacing: '-0.02em' }}>Target Environment Infrastructure</h3>
              <button onClick={() => { setIsManageModalOpen(false); setEditingAppId(null); }} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' }}><X size={20} /></button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxHeight: '380px', overflowY: 'auto', paddingRight: '4px' }}>
              {applications.length === 0 ? (
                <p style={{ textAlign: 'center', color: '#94a3b8', fontWeight: 500, padding: '2rem' }}>No telemetry roots mapped.</p>
              ) : (
                applications.map(app => (
                  <div key={app.id} style={{ border: '1px solid rgba(148,163,184,0.18)', borderRadius: '16px', padding: '1.25rem', background: '#101828' }}>
                    {editingAppId === app.id ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        <input 
                          type="text" 
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          style={{ width: '100%', padding: '8px 12px', border: '1px solid #94a3b8', borderRadius: '8px', fontSize: '0.9rem', fontWeight: 600 }}
                        />
                        <textarea 
                          rows={2}
                          value={editDesc}
                          onChange={(e) => setEditDesc(e.target.value)}
                          style={{ width: '100%', padding: '8px 12px', border: '1px solid #94a3b8', borderRadius: '8px', fontSize: '0.9rem', resize: 'none', lineHeight: '1.5' }}
                        />
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.25rem' }}>
                          <button onClick={() => setEditingAppId(null)} style={{ padding: '6px 12px', background: '#141c30', border: '1px solid #94a3b8', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
                          <button onClick={(e) => saveAppEdits(app, e)} style={{ padding: '6px 12px', background: '#10b981', color: '#141c30', border: 'none', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.25rem', cursor: 'pointer' }}><Check size={14} /> Update</button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ maxWidth: '82%' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <strong style={{ fontSize: '1rem', color: '#f1f5f9', fontWeight: 700 }}>{app.name}</strong>
                            <span style={{ fontSize: '0.65rem', padding: '2px 6px', background: 'rgba(56,189,248,0.12)', color: '#0369a1', borderRadius: '4px', fontWeight: 700, textTransform: 'uppercase' }}>{app.platform}</span>
                          </div>
                          <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginTop: '0.5rem', lineHeight: '1.5', margin: 0 }}>{app.description || "No environment specifics declared."}</p>
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button onClick={(e) => startEditing(app, e)} style={{ padding: '6px', background: '#141c30', border: '1px solid #94a3b8', borderRadius: '8px', color: '#94a3b8', cursor: 'pointer' }}><PenSquare size={14} /></button>
                          <button onClick={(e) => handleDeleteAppClick(app.id, e)} style={{ padding: '6px', background: 'rgba(251,113,133,0.12)', border: '1px solid rgba(251,113,133,0.3)', borderRadius: '8px', color: '#e11d48', cursor: 'pointer' }}><Trash2 size={14} /></button>
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
};