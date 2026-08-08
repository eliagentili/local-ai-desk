import { AlertTriangle } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Without this, an exception thrown while rendering unmounts the whole tree and
 * leaves a blank window — with jobs still running in the background and no way
 * to reach them. The boundary keeps the app on screen and offers a way back.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Interfaccia non disponibile", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="crash-screen" role="alert">
        <span className="crash-icon" aria-hidden="true">
          <AlertTriangle size={30} />
        </span>
        <h2>L'interfaccia si è interrotta</h2>
        <p>
          I lavori in corso e i risultati già salvati non sono stati toccati: restano
          nella cartella dati dell'app. Ricarica la finestra per riprendere.
        </p>
        <div className="crash-actions">
          <button
            className="button button-primary"
            onClick={() => window.location.reload()}
            type="button"
          >
            Ricarica l'interfaccia
          </button>
          <button
            className="button button-secondary"
            onClick={() => this.setState({ error: null })}
            type="button"
          >
            Riprova senza ricaricare
          </button>
        </div>
        <details className="crash-details">
          <summary>Dettaglio tecnico</summary>
          <code>{error.message}</code>
        </details>
      </div>
    );
  }
}
