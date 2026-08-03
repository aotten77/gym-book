import type { ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Activity,
  ArrowLeft,
  BarChart3,
  CalendarRange,
  ChevronDown,
  Dumbbell,
  FlaskConical,
  FolderKanban,
  RefreshCcw,
  Settings,
  WifiOff,
  X,
} from 'lucide-react';
import { ActiveSessionBar } from '@/components/ActiveSessionBar';
import { Button, IconButton } from '@/components/ui/Button';
import { db } from '@/db/appDb';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/store/ui-store';

/*
 * Die Beschriftungen benennen die Ebenen der Domäne, statt sie zu vermischen:
 * "Plan" stand hier für die Programme und war zugleich der Eyebrow der
 * Vorlagen-Seite - zwei Tabs mit demselben Wort. "Vorlage" wiederum sagt
 * nichts darüber, dass dahinter eine Trainingseinheit steckt.
 *
 * Nur die Beschriftung ändert sich. Routen und Entitätsnamen
 * (`WorkoutTemplate`, `/templates`) bleiben, wie sie sind.
 */
const navigationItems = [
  { to: '/', label: 'Heute', icon: Activity },
  { to: '/programs', label: 'Programm', icon: CalendarRange },
  { to: '/templates', label: 'Workouts', icon: FolderKanban },
  { to: '/exercises', label: 'Übungen', icon: Dumbbell },
  { to: '/history', label: 'Verlauf', icon: BarChart3 },
  { to: '/tests', label: 'Tests', icon: FlaskConical },
];

interface AppShellProps {
  title: string;
  /** Optional: nur setzen, wo die Zeile echten Kontext trägt (Woche, Programm). */
  eyebrow?: string;
  children: ReactNode;
}

export function AppShell({ title, eyebrow, children }: AppShellProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const inSession = location.pathname.startsWith('/session/');
  /*
   * Die laufende Einheit gehört hierher, nicht auf eine einzelne Seite: sie
   * überdauert jeden Seitenwechsel, und genau das soll der Streifen unten
   * zeigen. Eine Session, mehr kann es nicht geben - `startSessionFromTemplate`
   * prüft das in der Transaktion.
   */
  const activeSession = useLiveQuery(
    () => db.workoutSessions.where('status').equals('active').first(),
    [],
  );
  // Nur die *eigene* Session lässt sich minimieren. Eine abgeschlossene
  // Einheit unter `/session/:id` ist ein Rückweg, kein Ablegen.
  const isViewingActiveSession =
    inSession && Boolean(activeSession) && location.pathname === `/session/${activeSession?.id}`;
  const showSessionBar = !inSession && Boolean(activeSession);
  const isOnline = useUiStore((state) => state.isOnline);
  const isOfflineReady = useUiStore((state) => state.isOfflineReady);
  const isUpdateAvailable = useUiStore((state) => state.isUpdateAvailable);
  const deferredInstallPrompt = useUiStore((state) => state.deferredInstallPrompt);
  const setDeferredInstallPrompt = useUiStore((state) => state.setDeferredInstallPrompt);
  const setOfflineReady = useUiStore((state) => state.setOfflineReady);
  const setUpdateAvailable = useUiStore((state) => state.setUpdateAvailable);

  async function handleInstallApp() {
    if (!deferredInstallPrompt) {
      return;
    }

    await deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    setDeferredInstallPrompt(null);
  }

  function handleRefreshApp() {
    setUpdateAvailable(false);
    window.dispatchEvent(new Event('gym-book:update-app'));
  }

  return (
    <div className="min-h-[100dvh] text-content">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-control focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-accent-contrast"
      >
        Zum Inhalt springen
      </a>
      <div
        className={cn(
          'mx-auto flex min-h-[100dvh] max-w-md flex-col px-4 pt-[max(1rem,env(safe-area-inset-top))]',
          // Platz für die Bottom-Nav samt Home-Indicator - aber nur dort, wo
          // die Nav überhaupt gerendert wird. Der Streifen der laufenden
          // Einheit sitzt darüber und braucht seine eigene Höhe dazu, sonst
          // liegt er auf dem letzten Element der Seite.
          inSession
            ? 'pb-[calc(5rem+env(safe-area-inset-bottom))]'
            : showSessionBar
              ? 'pb-[calc(10.5rem+env(safe-area-inset-bottom))]'
              : 'pb-[calc(7rem+env(safe-area-inset-bottom))]',
        )}
      >
        {/*
          Die Kopfzeile steht direkt auf dem Papier, ohne eigene Karte: sie
          trägt nur Titel und Woche, und eine Fläche darum kostete oben
          Platz, den die Liste darunter besser gebraucht hat.
        */}
        <header className="px-1 pb-1 pt-2">
          <div className="flex items-center justify-between">
            <div>
              {eyebrow ? (
                <p className="truncate text-[10px] font-bold uppercase tracking-[0.16em] text-content-muted">
                  {eyebrow}
                </p>
              ) : null}
              {/*
                Der Titel ist das größte Element der Seite. Zuvor stand er in
                Fließtextgröße über einer Karte und ging dort unter - in einer
                App, die man im Vorbeigehen liest, muss zuerst zu erkennen
                sein, wo man ist.
              */}
              <h1
                className={cn(
                  'text-[30px] font-extrabold leading-[1.05] tracking-[-0.035em]',
                  eyebrow && 'mt-1',
                )}
              >
                {title}
              </h1>
            </div>
            <div className="flex flex-col items-end gap-2">
              {inSession ? (
                /*
                  Der einzige Ausgang aus der laufenden Einheit, der sie nicht
                  beendet.

                  Hier stand auch während der Session das Zahnrad - und war
                  damit der einzige Weg aus der Übungsliste heraus, der weder
                  abbricht noch abschließt. Wer nur kurz im Verlauf nachsehen
                  wollte, ging über die Einstellungen.

                  Der Pfeil zeigt nach unten, nicht zurück: ein Zurück-Pfeil
                  verspricht den Verlauf, und wer die Session über den Streifen
                  betreten hat, landete damit an einer beliebigen Stelle. Nach
                  unten heißt "läuft weiter, ich lege es nur ab" - unten steht
                  danach auch der Streifen, über den es zurückgeht.
                */
                <button
                  type="button"
                  onClick={() => navigate('/')}
                  aria-label={
                    isViewingActiveSession ? 'Session minimieren' : 'Zurück zur Übersicht'
                  }
                  title={isViewingActiveSession ? 'Session minimieren' : 'Zurück zur Übersicht'}
                  className={cn(
                    'flex h-12 w-12 items-center justify-center rounded-control border border-line text-content-secondary transition hover:bg-surface-raised',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                  )}
                >
                  {isViewingActiveSession ? <ChevronDown size={20} /> : <ArrowLeft size={20} />}
                </button>
              ) : (
                /*
                  Die Bottom-Nav trägt sechs Einträge; Einstellungen werden
                  selten gebraucht und sitzen deshalb hier statt dort.
                */
                <NavLink
                  to="/settings"
                  aria-label="Einstellungen"
                  title="Einstellungen"
                  className={({ isActive }) =>
                    cn(
                      'flex h-12 w-12 items-center justify-center rounded-control border transition',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                      isActive
                        ? 'border-transparent bg-accent text-accent-contrast'
                        : 'border-line text-content-secondary hover:bg-surface-raised',
                    )
                  }
                >
                  <Settings size={20} />
                </NavLink>
              )}
              {/*
                Der Offline-Zustand steht schon im Banner darunter; hier reicht
                das Abzeichen für den Offline-Fall, sonst ist es Rauschen.
              */}
              {!isOnline ? (
                <div
                  role="status"
                  className="inline-flex items-center gap-2 rounded-full bg-warning-soft px-2.5 py-1 text-xs font-medium text-warning"
                >
                  <WifiOff size={12} />
                  <span>Offline</span>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <main id="main-content" className="flex-1 py-5">
          <div className="space-y-4">
            {!isOnline ? (
              <div role="status" className="rounded-card border border-warning-border bg-warning-soft px-4 py-4">
                <p className="text-sm font-semibold text-warning">Offline aktiv</p>
                <p className="mt-1 text-sm text-content-secondary">
                  Bereits geladene Daten und lokale Änderungen bleiben weiter nutzbar.
                </p>
              </div>
            ) : null}

            {deferredInstallPrompt ? (
              <div className="rounded-card border border-accent-border bg-accent-soft px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-accent">App installieren</p>
                    <p className="mt-1 text-sm text-content-secondary">
                      Damit startet Gym Book wie eine native App und bleibt im Training schneller erreichbar.
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col gap-2">
                    <Button size="md" variant="primary" onClick={handleInstallApp}>
                      Installieren
                    </Button>
                    <IconButton
                      label="Installationshinweis ausblenden"
                      onClick={() => setDeferredInstallPrompt(null)}
                    >
                      <X size={14} />
                    </IconButton>
                  </div>
                </div>
              </div>
            ) : null}

            {isUpdateAvailable ? (
              <div role="status" className="rounded-card border border-line bg-surface px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-content">Update verfügbar</p>
                    <p className="mt-1 text-sm text-content-muted">
                      Neue Dateien sind geladen. Ein kurzer Reload zieht die aktuelle Version.
                    </p>
                  </div>
                  <Button size="md" variant="primary" onClick={handleRefreshApp} className="shrink-0">
                    <RefreshCcw size={14} />
                    Aktualisieren
                  </Button>
                </div>
              </div>
            ) : null}

            {isOfflineReady ? (
              <div role="status" className="rounded-card border border-line bg-surface px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-content">Offline-Basis bereit</p>
                    <p className="mt-1 text-sm text-content-muted">
                      Die App wurde für die lokale Nutzung zwischengespeichert.
                    </p>
                  </div>
                  <IconButton label="Hinweis schließen" onClick={() => setOfflineReady(false)}>
                    <X size={14} />
                  </IconButton>
                </div>
              </div>
            ) : null}

            {children}
          </div>
        </main>

        {!inSession ? (
          /*
            Die Leiste läuft bis an den Geräterand statt als schwebende
            Kachel darüber: der Home-Indicator sitzt ohnehin am Rand, und
            die freie Randbreite ging zuvor den sechs Beschriftungen ab.

            Der Streifen der laufenden Einheit sitzt im selben Block, nicht
            als zweites schwebendes Element darüber: die Höhe der Nav hängt an
            der Gerätebreite (unter 360px fallen die Beschriftungen weg), und
            ein danebengesetztes Element müsste sie kennen.
          */
          <div className="fixed inset-x-0 bottom-0 z-20 mx-auto w-full max-w-md overflow-hidden rounded-t-card border border-b-0 border-line bg-surface-glass shadow-soft backdrop-blur-xl">
            {activeSession ? <ActiveSessionBar session={activeSession} /> : null}
            <nav aria-label="Hauptnavigation">
              <ul className="grid grid-cols-6 gap-1 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2">
                {navigationItems.map(({ to, label, icon: Icon }) => (
                  <li key={to}>
                    <NavLink
                      to={to}
                      aria-label={label}
                      className={({ isActive }) =>
                        cn(
                          // px-0.5 und tracking-tight statt px-1: bei sechs
                          // Spalten blieben pro Zelle 47px, "Programm" braucht
                          // 51px. Die vier Pixel holt das Padding zurück, das
                          // engere Tracking gibt allen Labels etwas Reserve -
                          // "Workouts" lag zuvor exakt auf der Kante.
                          'flex min-h-touch flex-col items-center justify-center gap-1 rounded-control px-0.5 py-2 text-[10px] font-medium leading-tight tracking-tight text-content-muted transition hover:bg-surface-raised hover:text-content',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                          // Gefüllt statt zart getönt: auf hellem Grund ist eine
                          // 6-Prozent-Tönung als aktiver Zustand nicht zu sehen.
                          isActive && 'bg-accent font-semibold text-accent-contrast',
                        )
                      }
                    >
                      <Icon size={18} />
                      {/* Unterhalb von 360px reicht die Zellenbreite nicht für
                          die Beschriftung; das aria-label am Link trägt den
                          Namen dann weiter. */}
                      <span className="hidden w-full truncate text-center xs:block">{label}</span>
                    </NavLink>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        ) : null}
      </div>
    </div>
  );
}
