import { useState, useCallback } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { LibrarySidebar } from './components/LibrarySidebar.js';
import { Search } from './routes/Search.js';
import { McpManager } from './routes/McpManager.js';

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
                <Search
                  activeSessionId={activeSessionId}
                  onSessionStarted={handleSessionStarted}
                  onSessionDone={handleSessionDone}
                />
              }
            />
            <Route path="/mcps" element={<McpManager />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
