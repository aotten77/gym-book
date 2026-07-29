import type { ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  Activity,
  BarChart3,
  CalendarRange,
  Dumbbell,
  FlaskConical,
  FolderKanban,
  RefreshCcw,
  Settings,
  WifiOff,
  X,
} from 'lucide-react';
import { Button, IconButton } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/store/ui-store';

const navigationItems = [
  { to: '/', label: 'Heute', icon: Activity },
  // "Programme" passt bei sechs Spalten auf keinem Handy in eine Zeile.
  { to: '/programs', label: 'Plan', icon: CalendarRange },
  { to: '/templates', label: 'Vorlagen', icon: FolderKanban },
  { to: '/exercises', label: 'Uebung', icon: Dumbbell },
  { to: '/history', label: 'Verlauf', icon: BarChart3 },
  { to: '/tests', label: 'Tests', icon: FlaskConical },
];

interface AppShellProps {
  title: string;
  eyebrow: string;
  children: ReactNode;
}

export function AppShell({ title, eyebrow, children }: AppShellProps) {
  const location = useLocation();
  const inSession = location.pathname.startsWith('/session/');
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
          // Platz fuer die Bottom-Nav samt Home-Indicator - aber nur dort, wo
          // die Nav ueberhaupt gerendert wird.
          inSession
            ? 'pb-[calc(5rem+env(safe-area-inset-bottom))]'
            : 'pb-[calc(7rem+env(safe-area-inset-bottom))]',
        )}
      >
        <header className="rounded-card border border-line bg-surface-raised px-5 py-4 shadow-soft backdrop-blur">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-accent">{eyebrow}</p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight">{title}</h1>
            </div>
            <div className="flex flex-col items-end gap-2">
              {/*
                Die Bottom-Nav traegt sechs Eintraege; Einstellungen werden
                selten gebraucht und sitzen deshalb hier statt dort.
              */}
              <NavLink
                to="/settings"
                aria-label="Einstellungen"
                title="Einstellungen"
                className={({ isActive }) =>
                  cn(
                    'flex h-12 w-12 items-center justify-center rounded-control border transition',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                    isActive
                      ? 'border-accent-border bg-accent-soft text-accent'
                      : 'border-line text-content-secondary hover:bg-surface-raised',
                  )
                }
              >
                <Settings size={20} />
              </NavLink>
              {/*
                Der Offline-Zustand steht schon im Banner darunter; hier reicht
                das Abzeichen fuer den Offline-Fall, sonst ist es Rauschen.
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
              <div role="status" className="rounded-card border border-warning/20 bg-warning-soft px-4 py-4">
                <p className="text-sm font-semibold text-warning">Offline aktiv</p>
                <p className="mt-1 text-sm text-content-secondary">
                  Bereits geladene Daten und lokale Aenderungen bleiben weiter nutzbar.
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
              <div role="status" className="rounded-card border border-line bg-surface-raised px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-content">Update verfuegbar</p>
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
                      Die App wurde fuer die lokale Nutzung zwischengespeichert.
                    </p>
                  </div>
                  <IconButton label="Hinweis schliessen" onClick={() => setOfflineReady(false)}>
                    <X size={14} />
                  </IconButton>
                </div>
              </div>
            ) : null}

            {children}
          </div>
        </main>

        {!inSession ? (
          <nav
            aria-label="Hauptnavigation"
            className="fixed inset-x-0 bottom-0 z-20 mx-auto w-full max-w-md px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
          >
            <ul className="grid grid-cols-6 gap-1 rounded-card border border-line bg-zinc-950/90 p-2 shadow-soft backdrop-blur-xl">
              {navigationItems.map(({ to, label, icon: Icon }) => (
                <li key={to}>
                  <NavLink
                    to={to}
                    aria-label={label}
                    className={({ isActive }) =>
                      cn(
                        'flex min-h-touch flex-col items-center justify-center gap-1 rounded-control px-1 py-2 text-[10px] font-medium leading-tight text-content-muted transition hover:bg-surface-raised hover:text-content',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                        isActive && 'bg-accent-soft text-accent',
                      )
                    }
                  >
                    <Icon size={18} />
                    {/* Unterhalb von 360px reicht die Zellenbreite nicht fuer
                        die Beschriftung; das aria-label am Link traegt den
                        Namen dann weiter. */}
                    <span className="hidden w-full truncate text-center xs:block">{label}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </div>
    </div>
  );
}
