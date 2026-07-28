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
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/store/ui-store';

const navigationItems = [
  { to: '/', label: 'Heute', icon: Activity },
  { to: '/programs', label: 'Programme', icon: CalendarRange },
  { to: '/templates', label: 'Vorlagen', icon: FolderKanban },
  { to: '/history', label: 'Historie', icon: BarChart3 },
  { to: '/tests', label: 'Tests', icon: FlaskConical },
  { to: '/settings', label: 'Settings', icon: Settings },
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
    <div className="min-h-screen bg-app text-zinc-50">
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-4 pb-28 pt-4">
        <header className="rounded-3xl border border-white/10 bg-white/5 px-5 py-4 shadow-soft backdrop-blur">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-[0.24em] text-lime-300/80">{eyebrow}</p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight">{title}</h1>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-lime-300/15 text-lime-200">
                <Dumbbell size={22} />
              </div>
              <div
                className={cn(
                  'inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[11px] font-medium',
                  isOnline ? 'bg-lime-300/10 text-lime-200' : 'bg-amber-300/10 text-amber-100',
                )}
              >
                {isOnline ? <Wifi size={12} /> : <WifiOff size={12} />}
                <span>{isOnline ? 'Online' : 'Offline'}</span>
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 py-5">
          <div className="space-y-3">
            {!isOnline ? (
              <div className="rounded-3xl border border-amber-300/20 bg-amber-300/10 px-4 py-4">
                <p className="text-sm font-semibold text-amber-100">Offline aktiv</p>
                <p className="mt-1 text-sm text-amber-50/80">
                  Bereits geladene Daten und lokale Aenderungen bleiben weiter nutzbar.
                </p>
              </div>
            ) : null}

            {deferredInstallPrompt ? (
              <div className="rounded-3xl border border-lime-300/20 bg-lime-300/10 px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-lime-100">App installieren</p>
                    <p className="mt-1 text-sm text-lime-50/80">
                      Damit startet Gym Book wie eine native App und bleibt im Training schneller erreichbar.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleInstallApp}
                    className="rounded-2xl bg-lime-300 px-3 py-2 text-sm font-medium text-zinc-950 transition hover:brightness-105"
                  >
                    Installieren
                  </button>
                </div>
              </div>
            ) : null}

            {isUpdateAvailable ? (
              <div className="rounded-3xl border border-sky-300/20 bg-sky-300/10 px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-sky-100">Update verfuegbar</p>
                    <p className="mt-1 text-sm text-sky-50/80">
                      Neue Dateien sind geladen. Ein kurzer Reload zieht die aktuelle Version.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleRefreshApp}
                    className="inline-flex items-center gap-2 rounded-2xl bg-sky-300 px-3 py-2 text-sm font-medium text-zinc-950 transition hover:brightness-105"
                  >
                    <RefreshCcw size={14} />
                    Aktualisieren
                  </button>
                </div>
              </div>
            ) : null}

            {isOfflineReady ? (
              <div className="rounded-3xl border border-white/10 bg-zinc-950/45 px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-zinc-100">Offline-Basis bereit</p>
                    <p className="mt-1 text-sm text-zinc-400">
                      Die App wurde fuer die lokale Nutzung zwischengespeichert.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOfflineReady(false)}
                    className="rounded-2xl border border-white/10 p-2 text-zinc-400 transition hover:bg-white/5 hover:text-zinc-200"
                    aria-label="Hinweis schliessen"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            ) : null}

            {children}
          </div>
        </main>

        {!inSession ? (
          <nav className="fixed bottom-4 left-1/2 z-20 w-[calc(100%-24px)] max-w-md -translate-x-1/2 rounded-[28px] border border-white/10 bg-zinc-950/90 p-2 shadow-soft backdrop-blur-xl">
            <ul className="grid grid-cols-6 gap-2">
              {navigationItems.map(({ to, label, icon: Icon }) => (
                <li key={to}>
                  <NavLink
                    to={to}
                    className={({ isActive }) =>
                      cn(
                        'flex flex-col items-center gap-1 rounded-2xl px-2 py-3 text-[11px] font-medium text-zinc-400 transition hover:bg-white/5 hover:text-zinc-100',
                        isActive && 'bg-lime-300/10 text-lime-200',
                      )
                    }
                  >
                    <Icon size={18} />
                    <span>{label}</span>
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
