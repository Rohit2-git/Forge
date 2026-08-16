import { useState } from 'react';
import { AuthProvider } from './context/AuthContext';
import { AppProvider } from './context/AppContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { Repository } from './components/Repository';
import { Generator } from './components/Generator';
import { TestDataManager } from './components/TestDataManager';

// Generation-focused build: only four sections — Overview, Test Cases,
// AI Test Design, Test Data. Login is required (real accounts), but there
// are no role tiers — every account has identical access.

function App() {
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false);

  return (
    <AuthProvider>
      <ProtectedRoute>
        <AppProvider>
          <div className="app-layout">
            <Sidebar
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              isCollapsed={isSidebarCollapsed}
              onToggleCollapse={() => setIsSidebarCollapsed(prev => !prev)}
            />
            <main className="main-content">
              {/*
                All four sections stay mounted at all times — only the
                active one is shown (display: none on the rest), instead of
                a switch statement that fully unmounts whichever tab isn't
                active. Some of this UI (Generator's uploaded files, entered
                batch name/context, chosen data source) lives in local
                component state rather than AppContext, so unmounting it on
                every tab switch was silently wiping that state — exactly
                the "my uploaded files disappeared" bug. Keeping it mounted
                sidesteps that without having to thread every local field
                through context.
              */}
              <div style={{ display: activeTab === 'dashboard' ? 'block' : 'none' }}>
                <Dashboard setActiveTab={setActiveTab} />
              </div>
              <div style={{ display: activeTab === 'repository' ? 'block' : 'none' }}>
                <Repository />
              </div>
              <div style={{ display: activeTab === 'generator' ? 'block' : 'none' }}>
                <Generator />
              </div>
              <div style={{ display: activeTab === 'test-data' ? 'block' : 'none' }}>
                <TestDataManager />
              </div>
            </main>
          </div>
        </AppProvider>
      </ProtectedRoute>
    </AuthProvider>
  );
}

export default App;
