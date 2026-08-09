/**
 * User-visible text that the code *selects* — status labels, engine names,
 * section titles, install phases — together with every template that
 * interpolates or pluralises. Prose a component renders once stays next to that
 * component; what lives here is what a second language could not change without
 * rewriting logic.
 *
 * The interface is Italian-only today. This module is the seam a translation
 * would pass through, which is why no code outside it may compare a
 * user-visible string in order to decide what to do.
 */

import type { SectionId, WorkflowIntent } from "../types";

/** Single source for every `Intl` formatter and every locale-aware comparison.
 *  It is a constant, not a hard-coded argument, so adding a language means
 *  threading a value instead of hunting literals. */
export const UI_LOCALE = "it-IT";

/** Italian agreement is regular enough that a two-form helper is honest, and it
 *  keeps the count and its noun in the same place. */
export function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

export const sectionTitles: Record<SectionId, string> = {
  home: "Panoramica",
  library: "Libreria",
  studio: "Studio",
  activity: "Attività",
  models: "Modelli locali",
  settings: "Impostazioni",
};

const jobStatusLabels: Record<string, string> = {
  queued: "In coda",
  preparing: "Preparazione",
  uploading: "Trasferimento",
  running: "In corso",
  finalizing: "Salvataggio",
  cancelling: "Interruzione",
  completed: "Completato",
  cancelled: "Annullato",
  interrupted: "Interrotto",
  failed: "Errore",
};

/** An unknown status is shown as it arrives: a future state of the core is more
 *  useful on screen than the word "sconosciuto". */
export function jobStatusLabel(status: string): string {
  return jobStatusLabels[status] ?? status;
}

const engineNames: Record<string, string> = {
  markitdown: "MarkItDown",
  paddleocr: "PaddleOCR",
  glmocr: "GLM-OCR",
  "faster-whisper": "Faster Whisper",
  privacy: "Privacy Shield",
  docling: "Docling",
  "pdf-translate": "PDF Translate",
};

export function engineName(id: string): string {
  return engineNames[id] ?? id;
}

export const intentLabels: Record<WorkflowIntent, string> = {
  extract: "Estrai con Auto",
  translate: "Traduci PDF",
  ocr: "Forza OCR",
  transcribe: "Trascrivi",
  privacy: "Proteggi dati",
};

export const intentDescriptions: Record<WorkflowIntent, string> = {
  extract: "Auto distingue documento digitale, scansione e formato Office.",
  translate: "Traduzione locale con layout originale o versione bilingue.",
  ocr: "Analizza ogni pagina o immagine con PaddleOCR.",
  transcribe: "Audio e video in testo, sottotitoli o JSON.",
  privacy: "Rileva e maschera dati personali nei file testuali.",
};

export const intentOrder: WorkflowIntent[] = [
  "extract",
  "translate",
  "ocr",
  "transcribe",
  "privacy",
];

export const languageNames: ReadonlyArray<readonly [string, string]> = [
  ["auto", "Rileva automaticamente"],
  ["en", "Inglese"],
  ["it", "Italiano"],
  ["es", "Spagnolo"],
  ["fr", "Francese"],
  ["de", "Tedesco"],
  ["pt", "Portoghese"],
  ["nl", "Olandese"],
  ["pl", "Polacco"],
  ["ru", "Russo"],
  ["uk", "Ucraino"],
  ["ar", "Arabo"],
  ["zh-CN", "Cinese semplificato"],
  ["ja", "Giapponese"],
  ["ko", "Coreano"],
  ["hi", "Hindi"],
  ["tr", "Turco"],
];

/** Output formats per objective. The label depends on the objective — the same
 *  `json` is "con segmenti" for a transcription and "con rilevamenti" for the
 *  privacy filter — so the pairs stay grouped rather than collapsing into one
 *  map of format names. The first entry of each list is the default. */
export const intentFormats: Record<WorkflowIntent, Array<[string, string]>> = {
  extract: [
    ["markdown", "Markdown"],
    ["txt", "Testo semplice"],
  ],
  translate: [["pdf", "PDF"]],
  ocr: [
    ["markdown", "Markdown"],
    ["txt", "Testo semplice"],
    ["json", "JSON strutturato"],
  ],
  transcribe: [
    ["txt", "Testo semplice"],
    ["srt", "Sottotitoli SRT"],
    ["json", "JSON con segmenti"],
  ],
  privacy: [
    ["txt", "Testo protetto"],
    ["json", "JSON con rilevamenti"],
  ],
};

/** Welcome screen shown while the engines are missing: the first run has to say
 *  what the app does, what it will download and how long it takes, before
 *  anything starts. */
export const welcome = {
  eyebrow: "Primo avvio",
  title: "I motori non sono ancora sul computer.",
  intro:
    "Local AI Desk porta un file al risultato senza uscire dal dispositivo: nessun account, nessun servizio esterno, nessun documento che lascia il computer. Per farlo servono i motori locali, che si installano una sola volta.",
  objectivesTitle: "Cosa potrai fare",
  requirementsTitle: "Cosa serve",
  spaceLabel: "Spazio su disco",
  spaceUnknown: "Non rilevabile su questo volume",
  freeLabel: "Spazio libero",
  timeLabel: "Tempo",
  timeValue: "Tra 20 e 60 minuti",
  timeDetail: "Dipende dalla velocità della connessione. Puoi continuare a usare l’app.",
  networkLabel: "Connessione",
  networkValue: "Necessaria solo ora",
  networkDetail: "Serve per scaricare motori e modelli. Dopo, l’app lavora offline.",
  install: "Installa i motori",
  postpone: "Più tardi",
  postponeHint:
    "Puoi rimandare: libreria e importazioni funzionano subito, mentre l’elaborazione resta ferma finché i motori non sono installati.",
  unsupported:
    "Questa piattaforma non è supportata dai motori locali: l’app resta utilizzabile per libreria e importazioni.",
} as const;

/** Install progress and its refusals. The space check happens before any
 *  download starts, so its message names the missing gigabytes. */
export const install = {
  phaseEyebrow: "Installazione in corso",
  phaseUnknown: "Preparazione dell’ambiente locale",
  cancel: "Annulla installazione",
  cancelling: "Annullamento…",
  logHint: "L’avanzamento dettagliato è nel log di installazione.",
  notEnoughSpaceTitle: "Spazio su disco insufficiente",
  freeSpaceUnknown:
    "Lo spazio libero non è rilevabile su questo volume: assicurati di avere almeno lo spazio richiesto prima di iniziare.",
  spaceOk: "libero sul volume dei dati",
  stepOf: (step: number, total: number) => `Fase ${step} di ${total}`,
  missingSpace: (missing: string, required: string) =>
    `Servono ${required} sul volume che ospita i dati dell’app: mancano ${missing}. Libera spazio o sposta i dati su un volume più capiente, poi riprova.`,
  requires: (required: string) => `Richiede ${required} di spazio libero`,
} as const;

/** Studio: what to do when the engines are not running, in place of a chip that
 *  only stated the fact. */
export const engineGate = {
  title: "I motori locali non sono avviati",
  detail: "Nessun lavoro può partire. Aprili da Modelli: da lì puoi installarli o riavviarli.",
  action: "Apri Modelli",
} as const;

export const jobHistory = {
  toggleOpen: "Cronologia",
  toggleClose: "Chiudi cronologia",
  loading: "Lettura della cronologia…",
  empty: "Nessun evento registrato per questo lavoro.",
  copy: "Copia cronologia",
  copied: "Cronologia copiata",
  copiedDetail: "Puoi incollarla in una segnalazione: contiene fasi, stati e orari, non il contenuto del file.",
  copyFailedTitle: "Copia non riuscita",
  copyFailedDetail: "Seleziona il testo della cronologia e copialo a mano.",
  failedTitle: "Cronologia non disponibile",
} as const;

export const license = {
  eyebrow: "Licenza e sorgente",
  title: "Software libero, verificabile",
  identifier: "AGPL-3.0-or-later",
  detail:
    "Local AI Desk è distribuito sotto AGPL-3.0-or-later. Il testo completo della licenza è incluso nell’app; il codice sorgente di questa versione è pubblico.",
  thirdParty:
    "Le componenti di terze parti e le loro licenze sono elencate nelle note incluse nel pacchetto.",
  showLicense: "Mostra la licenza",
  openRepository: "Apri il codice sorgente",
  versionLabel: "Versione installata",
  licenseError: "Licenza non disponibile",
  repositoryError: "Sorgente non raggiungibile",
} as const;

/** One sentence per updater phase, shared by the panel that displays it and by
 *  the live region that announces it: two wordings for the same state would be
 *  two things to translate and one of them would drift. */
export function updatePhaseStatus(
  phase: string,
  availableVersion: string | null,
  progress: number | null,
): string {
  switch (phase) {
    case "unsupported":
      return "Disponibile nell’app installata";
    case "checking":
      return "Controllo in corso…";
    case "current":
      return "Hai già l’ultima versione";
    case "available":
      return `Versione ${availableVersion} disponibile`;
    case "downloading":
      return progress === null ? "Download protetto in corso…" : `Download ${progress}%`;
    case "downloaded":
      return "Download completato, pronto per l’installazione";
    case "installing":
      return "Verifica firma e preparazione…";
    case "ready":
      return "Aggiornamento pronto al riavvio";
    case "restarting":
      return "Riavvio in corso…";
    case "error":
      return "Controllo non riuscito";
    default:
      return "Controllo automatico attivo";
  }
}

export const roadmapNote =
  "I workflow riutilizzabili — cartelle sorvegliate, preset e condizioni — non sono ancora disponibili: sono dichiarati nella roadmap del progetto, non in questa versione.";

/** Announcements. They are separated from the visible copy because a screen
 *  reader needs the outcome in one sentence, without the layout around it. */
export const announce = {
  section: (title: string) => `Sezione ${title}`,
  loading: "Preparazione del workspace locale",
  reading: "Lettura dei file in corso",
  dropping: "Rilascia i file per elaborarli",
  modelsServerExposed:
    "Attenzione: il servizio modelli in uso accetta connessioni dalla rete. I dettagli sono in Modelli.",
  installStep: (step: number, total: number, label: string) =>
    `Installazione, fase ${step} di ${total}: ${label}`,
  updateProgress: (percent: number) => `Download dell’aggiornamento al ${percent} per cento`,
  jobCompleted: (name: string) => `${name} completato.`,
  jobCompletedWithWarnings: (name: string, warning: string) =>
    `${name} completato con avviso: ${warning}`,
  jobFailed: (name: string, reason: string) => `${name} non riuscito: ${reason}`,
  jobCancelled: (name: string) => `${name} annullato.`,
  jobInterrupted: (name: string) => `${name} interrotto: riprovalo da Attività.`,
  batchDone: (completed: number, failed: number) => {
    const parts = [
      completed
        ? `${completed} ${plural(completed, "lavoro completato", "lavori completati")}`
        : null,
      failed ? `${failed} non ${plural(failed, "riuscito", "riusciti")}` : null,
    ].filter(Boolean);
    return `Batch concluso. ${parts.join(", ")}.`;
  },
} as const;
