import type { ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Activity, BarChart3, Dumbbell, FolderKanban, FlaskConical, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

const navigationItems = [
  { to: '/', label: 'Heute', icon: Activity },
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

  return (
    <div className="min-h-screen bg-app text-zinc-50">
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-4 pb-28 pt-4">
        <header className="rounded-3xl border border-white/10 bg-white/5 px-5 py-4 shadow-soft backdrop-blur">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-[0.24em] text-lime-300/80">{eyebrow}</p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight">{title}</h1>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-lime-300/15 text-lime-200">
              <Dumbbell size={22} />
            </div>
          </div>
        </header>

        <main className="flex-1 py-5">{children}</main>

        {!inSession ? (
          <nav className="fixed bottom-4 left-1/2 z-20 w-[calc(100%-24px)] max-w-md -translate-x-1/2 rounded-[28px] border border-white/10 bg-zinc-950/90 p-2 shadow-soft backdrop-blur-xl">
            <ul className="grid grid-cols-5 gap-2">
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
