import { useState, useCallback } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { LibrarySidebar } from './components/LibrarySidebar.js';
import { RequireOnboarding } from './components/RequireOnboarding.js';
import { Search } from './routes/Search.js';
import { Settings } from './routes/Settings.js';
import { SettingsLlm } from './routes/SettingsLlm.js';
import { McpManager } from './routes/McpManager.js';
import { Registry } from './routes/Registry.js';
import { Onboarding } from './routes/Onboarding.js';

export default function App() {
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>(undefined);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleSelect = useCallback((id: string) => setActiveSessionId(id), []);
  const handleNewSearch = useCallback(() => setActiveSessionId(undefined), []);
  const handleSessionStarted = useCallback((id: string) => setActiveSessionId(id), []);
  const handleSessionDone = useCallback(() => setRefreshKey((n) => n + 1), []);

  return (
    <BrowserRouter>
      <div className="flex h-screen min-h-0">
        <LibrarySidebar
          activeSessionId={activeSessionId}
          refreshKey={refreshKey}
          onSelect={handleSelect}
          onNewSearch={handleNewSearch}
        />
        <main className="flex-1 overflow-y-auto">
          <Routes>
            <Route
              path="/"
              element={
                <RequireOnboarding>
                  <Search
                    activeSessionId={activeSessionId}
                    onSessionStarted={handleSessionStarted}
                    onSessionDone={handleSessionDone}
                  />
                </RequireOnboarding>
              }
            />
            <Route path="/settings" element={<RequireOnboarding><Settings /></RequireOnboarding>}>
              <Route index element={<Navigate to="/settings/llm" replace />} />
              <Route path="llm" element={<SettingsLlm />} />
              <Route path="mcps" element={<McpManager />} />
              <Route path="registry" element={<Registry />} />
            </Route>
            {/* Legacy routes redirect to settings */}
            <Route path="/mcps" element={<Navigate to="/settings/mcps" replace />} />
            <Route path="/registry" element={<Navigate to="/settings/registry" replace />} />
            <Route path="/onboarding" element={<Onboarding />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
