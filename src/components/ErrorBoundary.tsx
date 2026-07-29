import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Faengt Render-Fehler ab.
 *
 * Ohne diese Grenze unmountet React den kompletten Baum, wenn irgendeine Seite
 * beim Rendern wirft - der Nutzer sieht dann mitten im Training eine weisse
 * Seite und hat keinen Weg zurueck ausser einem Reload.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Unerwarteter Render-Fehler', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;

    if (!error) {
      return this.props.children;
    }

    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-app px-6 text-zinc-100">
        <div className="w-full max-w-sm rounded-[32px] border border-rose-300/20 bg-rose-300/10 p-6 text-center shadow-soft">
          <p className="text-xs uppercase tracking-[0.24em] text-rose-200/90">Gym Book</p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">Etwas ist schiefgelaufen</h1>
          <p className="mt-3 text-sm text-rose-100/90">{error.message}</p>
          <p className="mt-3 text-sm text-rose-100/80">
            Deine Trainingsdaten liegen lokal und sind davon nicht betroffen.
          </p>
          <div className="mt-5 grid gap-2">
            <button
              type="button"
              onClick={this.handleReset}
              className="rounded-3xl bg-lime-300 px-4 py-4 text-sm font-semibold text-zinc-950 transition hover:brightness-105 focus-visible:ring-2 focus-visible:ring-lime-300/70"
            >
              Nochmal versuchen
            </button>
            <button
              type="button"
              onClick={() => {
                window.location.hash = '#/';
                this.handleReset();
              }}
              className="rounded-3xl border border-white/10 px-4 py-4 text-sm font-medium text-zinc-200 transition hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-lime-300/70"
            >
              Zur Startseite
            </button>
          </div>
        </div>
      </div>
    );
  }
}
