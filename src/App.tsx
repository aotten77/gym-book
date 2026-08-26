import { useEffect, useState } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import Home from '@/pages/Home';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { bootstrapAppData } from '@/db/bootstrap';
import { requestPersistentStorage } from '@/lib/storage';
import { ExercisesPage } from '@/pages/ExercisesPage';
import { HistoryPage } from '@/pages/HistoryPage';
import { HistorySessionPage } from '@/pages/HistorySessionPage';
import { ProgramsManagePage } from '@/pages/ProgramsManagePage';
import { SessionPage } from '@/pages/SessionPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { TemplateDetailPage } from '@/pages/TemplateDetailPage';
import { TemplatesPage } from '@/pages/TemplatesPage';
import { TestsPage } from '@/pages/TestsPage';

export default function App() {
  const [ready, setReady] = useState(false);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);

  useEffect(() => {
    /*
     * Ohne dauerhaften Speicher darf der Browser IndexedDB bei Speicherdruck
     * räumen - bei einer App ohne Backend wäre das die gesamte
     * Trainingshistorie. Safari entscheidet nach eigenen Heuristiken und zeigt
     * keinen Dialog, ein abgelehnter Antrag ist deshalb kein Fehlerfall.
     */
    void requestPersistentStorage();

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
      <div className="flex min-h-screen items-center justify-center bg-app px-6 text-content">
        <div className="w-full max-w-sm rounded-card border border-line bg-surface p-6 text-center shadow-soft">
          <p className="text-xs uppercase tracking-[0.24em] text-content-muted">Gym Book</p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">Lokale Trainingsdaten werden vorbereitet</h1>
          <p className="mt-3 text-sm text-content-muted">
            Dexie initialisiert die Demo-Daten und stellt die erste Offline-Basis her.
          </p>
        </div>
      </div>
    );
  }

  if (bootstrapError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-app px-6 text-content">
        <div className="w-full max-w-sm rounded-card border border-danger-border bg-danger-soft p-6 text-center shadow-soft">
          <p className="text-xs uppercase tracking-[0.24em] text-danger">Gym Book</p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">Initialisierung fehlgeschlagen</h1>
          <p className="mt-3 text-sm text-content-secondary">{bootstrapError}</p>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <HashRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          {/*
            `/programs` gehört der Wochenansicht - bis die steht, führt der
            Reiter direkt auf die Verwaltung, statt eine leere Seite zu zeigen.
          */}
          <Route path="/programs" element={<Navigate to="/programs/manage" replace />} />
          <Route path="/programs/manage" element={<ProgramsManagePage />} />
          <Route path="/exercises" element={<ExercisesPage />} />
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
    </ErrorBoundary>
  );
}
