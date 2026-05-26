import { useState, useCallback } from 'react';
import { LibrarySidebar } from './components/LibrarySidebar.js';
import { Search } from './routes/Search.js';

export default function App() {
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>(undefined);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleSelect = useCallback((id: string) => {
    setActiveSessionId(id);
  }, []);

  const handleNewSearch = useCallback(() => {
    setActiveSessionId(undefined);
  }, []);

  const handleSessionStarted = useCallback((id: string) => {
    setActiveSessionId(id);
  }, []);

  const handleSessionDone = useCallback(() => {
    setRefreshKey((n) => n + 1);
  }, []);

  return (
    <div className="flex h-screen min-h-0">
      <LibrarySidebar
        activeSessionId={activeSessionId}
        refreshKey={refreshKey}
        onSelect={handleSelect}
        onNewSearch={handleNewSearch}
      />
      <main className="flex-1 overflow-y-auto">
        <Search
          activeSessionId={activeSessionId}
          onSessionStarted={handleSessionStarted}
          onSessionDone={handleSessionDone}
        />
      </main>
    </div>
  );
}
