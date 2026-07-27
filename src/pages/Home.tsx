import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowRight, Play, RotateCcw } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { SectionCard } from '@/components/SectionCard';
import { StatCard } from '@/components/StatCard';
import { db } from '@/db/appDb';
import { startSessionFromTemplate } from '@/db/session-actions';
import { formatDateTime } from '@/lib/format';

export default function Home() {
  const navigate = useNavigate();
  const templates = useLiveQuery(() => db.workoutTemplates.toArray(), []);
  const settings = useLiveQuery(() => db.appSettings.get('app-settings'), []);
  const program = useLiveQuery(async () => {
    const appSettings = await db.appSettings.get('app-settings');

    if (!appSettings?.activeProgramId) {
      return undefined;
    }

    return db.programs.get(appSettings.activeProgramId);
  }, []);
  const activeSession = useLiveQuery(
    () => db.workoutSessions.where('status').equals('active').first(),
    [],
  );
  const lastCompletedSession = useLiveQuery(
    async () => {
      const completed = await db.workoutSessions.where('status').equals('completed').toArray();
      return completed.sort((left, right) =>
        (right.completedAt ?? '').localeCompare(left.completedAt ?? ''),
      )[0];
    },
    [],
  );

  const templateCountLabel = useMemo(() => `${templates?.length ?? 0}`, [templates]);

  return (
    <AppShell title="Gym Book" eyebrow="Offline-First Training">
      <div className="space-y-4">
        <section className="grid grid-cols-2 gap-3">
          <StatCard
            label="Aktive Woche"
            value={`W${settings?.weekOverride ?? program?.activeWeek ?? 1}`}
            hint={program?.name ?? 'Noch kein Programm'}
          />
          <StatCard
            label="Vorlagen"
            value={templateCountLabel}
            hint="Materialisiert beim Start in eine Session"
          />
        </section>

        <SectionCard
          title="Heute im Fokus"
          subtitle="Schneller Einstieg fuer verschwitzte Haende und kurze Aufmerksamkeit."
        >
          <div className="space-y-3">
            {activeSession ? (
              <button
                type="button"
                onClick={() => navigate(`/session/${activeSession.id}`)}
                className="flex w-full items-center justify-between rounded-3xl bg-lime-300 px-4 py-4 text-left text-zinc-950 transition hover:brightness-105"
              >
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-zinc-700">Aktive Session</p>
                  <p className="mt-2 text-lg font-semibold">{activeSession.templateNameSnapshot}</p>
                  <p className="mt-1 text-sm text-zinc-700">
                    Gestartet {formatDateTime(activeSession.startedAt)}
                  </p>
                </div>
                <RotateCcw size={18} />
              </button>
            ) : (
              <div className="rounded-3xl border border-dashed border-white/10 bg-zinc-950/35 px-4 py-5 text-sm text-zinc-400">
                Keine aktive Session offen. Starte direkt aus einer Vorlage.
              </div>
            )}

            <div className="grid gap-3">
              {(templates ?? []).map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={async () => {
                    const sessionId = await startSessionFromTemplate(template.id);
                    navigate(`/session/${sessionId}`);
                  }}
                  className="flex items-center justify-between rounded-3xl border border-white/10 bg-white/[0.04] px-4 py-4 text-left transition hover:border-lime-300/30 hover:bg-white/[0.07]"
                >
                  <div>
                    <p className="text-sm font-semibold text-zinc-50">{template.name}</p>
                    <p className="mt-1 text-sm text-zinc-400">{template.notes}</p>
                  </div>
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-lime-300/10 text-lime-200">
                    <Play size={18} />
                  </div>
                </button>
              ))}
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Letzter Abschluss"
          subtitle="Historie bleibt stabil, auch wenn du spaeter Templates aenderst."
          action={
            <button
              type="button"
              onClick={() => navigate('/history')}
              className="rounded-2xl border border-white/10 px-3 py-2 text-sm text-zinc-300 transition hover:bg-white/5"
            >
              Historie
            </button>
          }
        >
          {lastCompletedSession ? (
            <div className="rounded-3xl bg-zinc-950/45 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Zuletzt beendet</p>
              <div className="mt-2 flex items-center justify-between gap-3">
                <div>
                  <p className="text-lg font-semibold text-zinc-50">
                    {lastCompletedSession.templateNameSnapshot}
                  </p>
                  <p className="mt-1 text-sm text-zinc-400">
                    {formatDateTime(lastCompletedSession.completedAt)}
                  </p>
                </div>
                <ArrowRight className="text-zinc-500" size={18} />
              </div>
            </div>
          ) : (
            <div className="rounded-3xl bg-zinc-950/45 p-4 text-sm text-zinc-400">
              Sobald du eine Session abschliesst, taucht sie hier als schneller Ruecksprung auf.
            </div>
          )}
        </SectionCard>
      </div>
    </AppShell>
  );
}
