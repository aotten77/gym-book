import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Fängt Render-Fehler ab.
 *
 * Ohne diese Grenze unmountet React den kompletten Baum, wenn irgendeine Seite
 * beim Rendern wirft - der Nutzer sieht dann mitten im Training eine weiße
 * Seite und hat keinen Weg zurück außer einem Reload.
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
      <div className="flex min-h-[100dvh] items-center justify-center bg-app px-6 text-content">
        <div className="w-full max-w-sm rounded-card border border-danger-border bg-danger-soft p-6 text-center shadow-soft">
          <p className="text-xs uppercase tracking-[0.24em] text-danger">Gym Book</p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">Etwas ist schiefgelaufen</h1>
          <p className="mt-3 text-sm text-content-secondary">{error.message}</p>
          <p className="mt-3 text-sm text-content-secondary">
            Deine Trainingsdaten liegen lokal und sind davon nicht betroffen.
          </p>
          <div className="mt-5 grid gap-2">
            <button
              type="button"
              onClick={this.handleReset}
              className="min-h-touch rounded-panel bg-accent px-4 py-4 text-sm font-semibold text-accent-contrast transition hover:opacity-90"
            >
              Nochmal versuchen
            </button>
            <button
              type="button"
              onClick={() => {
                window.location.hash = '#/';
                this.handleReset();
              }}
              className="min-h-touch rounded-panel border border-line px-4 py-4 text-sm font-medium text-content-secondary transition hover:bg-surface-raised"
            >
              Zur Startseite
            </button>
          </div>
        </div>
      </div>
    );
  }
}
