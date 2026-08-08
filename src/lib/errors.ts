/**
 * Errors cross the IPC boundary as plain strings produced by Rust, by SQLite or
 * by the operating system. Showing them verbatim hands the user a debug string
 * — often in English, sometimes containing an absolute path — instead of
 * telling them what to do next.
 *
 * Known causes are mapped to an actionable sentence; anything unrecognised is
 * kept, because a specific unknown message is still more useful than a generic
 * one. The raw text stays available for diagnostics.
 */

interface Mapping {
  match: RegExp;
  message: string;
}

const mappings: Mapping[] = [
  {
    match: /no space left|disk full|spazio su disco|not enough space|os error 28/i,
    message:
      "Spazio su disco esaurito. Libera spazio e riprova: il risultato parziale è stato rimosso.",
  },
  {
    match: /permission denied|access is denied|operation not permitted|os error (1|13)\b/i,
    message:
      "Il sistema non ha concesso l'accesso a questo file. Controlla i permessi della cartella e riprova.",
  },
  {
    match: /no such file|cannot find the file|non è più disponibile|os error 2\b/i,
    message:
      "Il file non si trova più nel percorso indicato: potrebbe essere stato spostato o rinominato.",
  },
  {
    match: /connection refused|connect(ion)? error|tcp connect|os error 61\b/i,
    message:
      "I motori locali non rispondono. Aprili da Modelli, avviali e riprova.",
  },
  {
    match: /database is locked|sqlite/i,
    message:
      "Il database locale era occupato. Riprova tra qualche secondo; nessun dato è andato perso.",
  },
  {
    match: /timed? out|timeout/i,
    message: "L'operazione ha superato il tempo massimo. Riprova.",
  },
];

export function describeError(error: unknown): string {
  const raw = typeof error === "string" ? error : error instanceof Error ? error.message : String(error);
  const trimmed = raw.replace(/^Error:\s*/i, "").trim();
  if (!trimmed) return "Si è verificato un errore imprevisto. Riprova.";
  const known = mappings.find((mapping) => mapping.match.test(trimmed));
  return known ? known.message : trimmed;
}
