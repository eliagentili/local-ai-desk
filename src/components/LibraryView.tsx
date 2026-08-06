import { File, Filter, Search } from "lucide-react";
import { useState } from "react";

import { formatBytes, formatDate } from "../lib/format";
import type { LibraryItem } from "../types";

interface LibraryViewProps {
  items: LibraryItem[];
  onImport: () => void;
}

export function LibraryView({ items, onImport }: LibraryViewProps) {
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLocaleLowerCase("it");
  const visibleItems = normalized
    ? items.filter((item) =>
        `${item.name} ${item.kind}`.toLocaleLowerCase("it").includes(normalized),
      )
    : items;

  return (
    <div className="view-stack">
      <section className="view-intro">
        <div>
          <span className="eyebrow">Archivio locale</span>
          <h2>I tuoi file, una volta sola.</h2>
          <p>
            Ogni elemento viene indicizzato nel database locale e deduplicato in
            streaming. Anche i file molto grandi non vengono caricati in memoria.
          </p>
        </div>
        <button className="button button-primary" onClick={onImport} type="button">
          Importa file
        </button>
      </section>

      <section className="surface-panel library-panel">
        <div className="library-toolbar">
          <label className="search-field">
            <Search size={16} />
            <span className="sr-only">Cerca nella libreria</span>
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Cerca per nome o tipo"
              type="search"
              value={query}
            />
          </label>
          <span className="toolbar-count">
            <Filter size={14} />
            {visibleItems.length} {visibleItems.length === 1 ? "elemento" : "elementi"}
          </span>
        </div>

        {visibleItems.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Tipo</th>
                  <th>Dimensione</th>
                  <th>Aggiunto</th>
                  <th>Stato</th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div className="table-name">
                        <span className="table-file-icon">
                          <File size={15} />
                        </span>
                        <div>
                          <strong>{item.name}</strong>
                          <span title={item.path}>{item.path}</span>
                        </div>
                      </div>
                    </td>
                    <td>{item.kind}</td>
                    <td>{formatBytes(item.sizeBytes)}</td>
                    <td>{formatDate(item.addedAt)}</td>
                    <td>
                      <span className="status-label">Pronto</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <span className="empty-icon">
              <File size={24} />
            </span>
            <h3>{query ? "Nessun risultato" : "La libreria aspetta il primo file"}</h3>
            <p>
              {query
                ? "Prova un nome o un tipo diverso."
                : "Puoi selezionare più documenti, video e registrazioni in una sola volta."}
            </p>
            {!query ? (
              <button className="button button-secondary" onClick={onImport} type="button">
                Scegli i file
              </button>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
