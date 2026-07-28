import { useEffect, useState } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import Home from '@/pages/Home';
import { bootstrapAppData } from '@/db/bootstrap';
import { HistoryPage } from '@/pages/HistoryPage';
import { HistorySessionPage } from '@/pages/HistorySessionPage';
import { ProgramsPage } from '@/pages/ProgramsPage';
import { SessionPage } from '@/pages/SessionPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { TemplateDetailPage } from '@/pages/TemplateDetailPage';
import { TemplatesPage } from '@/pages/TemplatesPage';
import { TestsPage } from '@/pages/TestsPage';

export default function App() {
  const [ready, setReady] = useState(false);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);

  useEffect(() => {
    bootstrapAppData()
      .catch((error) => {
        const message = error instanceof Error ? error.message : 'Unbekannter Initialisierungsfehler';
        console.error('Bootstrap failed', error);
        setBootstrapError(message);
      })
      .finally(() => {
        setReady(true);
      });
  }, []);

  if (!ready && !bootstrapError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-app px-6 text-zinc-100">
        <div className="w-full max-w-sm rounded-[32px] border border-white/10 bg-white/[0.05] p-6 text-center shadow-soft">
          <p className="text-xs uppercase tracking-[0.24em] text-lime-300/80">Gym Book</p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">Lokale Trainingsdaten werden vorbereitet</h1>
          <p className="mt-3 text-sm text-zinc-400">
            Dexie initialisiert die Demo-Daten und stellt die erste Offline-Basis her.
          </p>
        </div>
      </div>
    );
  }

  if (bootstrapError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-app px-6 text-zinc-100">
        <div className="w-full max-w-sm rounded-[32px] border border-rose-300/20 bg-rose-300/10 p-6 text-center shadow-soft">
          <p className="text-xs uppercase tracking-[0.24em] text-rose-200/80">Gym Book</p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">Initialisierung fehlgeschlagen</h1>
          <p className="mt-3 text-sm text-rose-100/90">{bootstrapError}</p>
        </div>
      </div>
    );
  }

  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/programs" element={<ProgramsPage />} />
        <Route path="/templates" element={<TemplatesPage />} />
        <Route path="/templates/:templateId" element={<TemplateDetailPage />} />
        <Route path="/session/:sessionId" element={<SessionPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/history/session/:sessionId" element={<HistorySessionPage />} />
        <Route path="/tests" element={<TestsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}
