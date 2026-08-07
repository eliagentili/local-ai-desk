import {
  Check,
  FileSearch,
  Languages,
  Mic2,
  ScanText,
  ShieldCheck,
  Sparkles,
  UploadCloud,
} from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";

import { formatBytes } from "../lib/format";
import type {
  BridgeStatus,
  LibraryItem,
  WorkflowIntent,
  WorkflowOptions,
} from "../types";

const intents = [
  {
    id: "extract" as const,
    label: "Estrai con Auto",
    description: "Auto distingue documento digitale, scansione e formato Office.",
    icon: Sparkles,
  },
  {
    id: "translate" as const,
    label: "Traduci PDF",
    description: "Traduzione locale con layout originale o versione bilingue.",
    icon: Languages,
  },
  {
    id: "ocr" as const,
    label: "Forza OCR",
    description: "Analizza ogni pagina o immagine con PaddleOCR.",
    icon: ScanText,
  },
  {
    id: "transcribe" as const,
    label: "Trascrivi",
    description: "Audio e video in testo, sottotitoli o JSON.",
    icon: Mic2,
  },
  {
    id: "privacy" as const,
    label: "Proteggi dati",
    description: "Rileva e maschera dati personali nei file testuali.",
    icon: ShieldCheck,
  },
];

const languages = [
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
] as const;

const translationLanguages = languages.filter(([value]) => value !== "auto");

const intentFormats: Record<WorkflowIntent, Array<[string, string]>> = {
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

function fileExtension(path: string): string {
  const filename = path.split("/").pop() ?? path;
  return filename.includes(".") ? filename.split(".").pop()?.toLowerCase() ?? "" : "";
}

function supportsIntent(item: LibraryItem, intent: WorkflowIntent): boolean {
  const suffix = fileExtension(item.path);
  if (intent === "translate") return suffix === "pdf";
  if (intent === "ocr") {
    return ["pdf", "png", "jpg", "jpeg", "webp", "tiff", "tif", "bmp"].includes(suffix);
  }
  if (intent === "transcribe") {
    return [
      "wav",
      "mp3",
      "m4a",
      "aac",
      "flac",
      "ogg",
      "mp4",
      "mov",
      "mkv",
      "webm",
      "avi",
      "m4v",
    ].includes(suffix);
  }
  if (intent === "privacy") {
    return ["txt", "md", "csv", "json", "html", "xml"].includes(suffix);
  }
  return true;
}

interface StudioViewProps {
  items: LibraryItem[];
  bridge: BridgeStatus;
  starting: boolean;
  onImport: () => void;
  onQuickPick: () => void;
  onClearQuick: () => void;
  onStart: (itemIds: string[], quickPaths: string[], options: WorkflowOptions) => void;
  quickItems: LibraryItem[];
}

export function StudioView({
  items,
  bridge,
  starting,
  onImport,
  onQuickPick,
  onClearQuick,
  onStart,
  quickItems,
}: StudioViewProps) {
  const [intent, setIntent] = useState<WorkflowIntent>("extract");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const [outputFormat, setOutputFormat] = useState("markdown");
  const [language, setLanguage] = useState("auto");
  const [sourceLanguage, setSourceLanguage] = useState("en");
  const [targetLanguage, setTargetLanguage] = useState("it");
  const [translationMode, setTranslationMode] = useState<"translated" | "bilingual">(
    "translated",
  );
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase("it"));
  const allItems = useMemo(() => [...quickItems, ...items], [items, quickItems]);
  const itemById = useMemo(
    () => new Map(allItems.map((item) => [item.id, item])),
    [allItems],
  );
  const compatible = useMemo(
    () => allItems.filter((item) => supportsIntent(item, intent)),
    [allItems, intent],
  );
  const visible = useMemo(
    () =>
      compatible.filter((item) =>
        `${item.name} ${item.kind}`.toLocaleLowerCase("it").includes(deferredQuery),
      ),
    [compatible, deferredQuery],
  );
  const selectedQuickCount = Array.from(selected).filter(
    (id) => itemById.get(id)?.status === "temporary",
  ).length;

  useEffect(() => {
    setSelected((current) => {
      const next = new Set(Array.from(current).filter((id) => itemById.has(id)));
      for (const item of quickItems) {
        if (supportsIntent(item, intent)) next.add(item.id);
      }
      return next;
    });
  }, [intent, itemById, quickItems]);

  function chooseIntent(next: WorkflowIntent) {
    setIntent(next);
    setOutputFormat(intentFormats[next][0][0]);
    setSelected((current) => {
      const filtered = new Set<string>();
      for (const id of current) {
        const item = itemById.get(id);
        if (item && supportsIntent(item, next)) filtered.add(id);
      }
      return filtered;
    });
  }

  function chooseSourceLanguage(next: string) {
    if (next === targetLanguage) setTargetLanguage(sourceLanguage);
    setSourceLanguage(next);
  }

  function toggleItem(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelected((current) => {
      const next = new Set(current);
      const allSelected = visible.length > 0 && visible.every((item) => next.has(item.id));
      for (const item of visible) {
        if (allSelected) next.delete(item.id);
        else next.add(item.id);
      }
      return next;
    });
  }

  function start() {
    const selectedItems = Array.from(selected)
      .map((id) => itemById.get(id))
      .filter((item): item is LibraryItem => Boolean(item));
    const itemIds = selectedItems
      .filter((item) => item.status !== "temporary")
      .map((item) => item.id);
    const quickPaths = selectedItems
      .filter((item) => item.status === "temporary")
      .map((item) => item.path);
    onStart(itemIds, quickPaths, {
      intent,
      outputFormat,
      language,
      sourceLanguage,
      targetLanguage,
      translationMode,
    });
  }

  return (
    <div className="view-stack studio-view">
      <section className="view-intro studio-intro">
        <div>
          <span className="eyebrow">Obiettivo esplicito, motore automatico</span>
          <h2>Che risultato vuoi ottenere?</h2>
          <p>
            Tu scegli l’obiettivo. Auto analizza formato e contenuto per decidere il
            parser; traduzione, OCR e trascrizione usano invece il relativo motore locale.
          </p>
        </div>
        <span className="large-status" data-ready={bridge.available}>
          <span className="status-dot" />
          {bridge.available
            ? `fino a ${bridge.batchParallelism} lavori in parallelo`
            : "motori non avviati"}
        </span>
      </section>

      <section className="intent-grid" aria-label="Scegli il risultato">
        {intents.map((item) => {
          const Icon = item.icon;
          return (
            <button
              aria-pressed={intent === item.id}
              className="intent-card"
              data-active={intent === item.id}
              key={item.id}
              onClick={() => chooseIntent(item.id)}
              type="button"
            >
              <span className="intent-icon"><Icon size={19} /></span>
              <strong>{item.label}</strong>
              <p>{item.description}</p>
              {intent === item.id ? <Check className="intent-check" size={15} /> : null}
            </button>
          );
        })}
      </section>

      <section className="studio-grid">
        <div className="surface-panel source-picker">
          <div className="panel-heading source-heading">
            <div>
              <span className="eyebrow">Sorgenti compatibili</span>
              <h3>{selected.size ? `${selected.size} selezionati` : "Scegli o trascina"}</h3>
            </div>
            <div className="source-heading-actions">
              {quickItems.length ? (
                <button
                  className="text-button"
                  onClick={onClearQuick}
                  type="button"
                >
                  Svuota rapidi
                </button>
              ) : null}
              <button className="text-button" onClick={toggleAllVisible} type="button">
                {visible.length > 0 && visible.every((item) => selected.has(item.id))
                  ? "Deseleziona"
                  : "Seleziona tutti"}
              </button>
            </div>
          </div>
          <button
            className="studio-drop-zone"
            data-filled={quickItems.length > 0}
            onClick={onQuickPick}
            type="button"
          >
            <span className="studio-drop-icon"><UploadCloud size={20} /></span>
            <span>
              <strong>
                {quickItems.length
                  ? `${quickItems.length} ${quickItems.length === 1 ? "file rapido pronto" : "file rapidi pronti"}`
                  : "Trascina file qui o scegli dal computer"}
              </strong>
              <small>Fuori dalla Libreria · copie di lavoro eliminate automaticamente</small>
            </span>
          </button>
          <label className="search-field studio-search">
            <FileSearch size={15} />
            <span className="sr-only">Cerca sorgenti</span>
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Cerca tra file rapidi e Libreria"
              type="search"
              value={query}
            />
          </label>
          {visible.length ? (
            <div className="source-list">
              {visible.map((item) => (
                <label className="source-row" data-selected={selected.has(item.id)} key={item.id}>
                  <input
                    checked={selected.has(item.id)}
                    onChange={() => toggleItem(item.id)}
                    type="checkbox"
                  />
                  <span className="source-check"><Check size={12} /></span>
                  <span className="file-badge">{item.kind.slice(0, 3).toUpperCase()}</span>
                  <span className="row-copy">
                    <strong>{item.name}</strong>
                    <span>
                      {formatBytes(item.sizeBytes)} · {item.kind}
                      {item.status === "temporary" ? " · temporaneo" : " · Libreria"}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <div className="studio-empty">
              <strong>{allItems.length ? "Nessun file compatibile" : "Nessun file selezionato"}</strong>
              <p>
                {allItems.length
                  ? "Cambia obiettivo oppure scegli un formato adatto."
                  : "Trascina uno o più file: verranno usati per il batch senza entrare nella Libreria."}
              </p>
              <div className="studio-empty-actions">
                <button className="button button-primary" onClick={onQuickPick} type="button">
                  Scegli file rapidi
                </button>
                <button className="button button-secondary" onClick={onImport} type="button">
                  Aggiungi alla Libreria
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="surface-panel workflow-config">
          <span className="eyebrow">Configurazione</span>
          <h3>{intents.find((item) => item.id === intent)?.label}</h3>
          <div className="config-fields">
            {intent === "translate" ? (
              <>
                <SelectField
                  label="Lingua originale"
                  onChange={chooseSourceLanguage}
                  options={translationLanguages}
                  value={sourceLanguage}
                />
                <SelectField
                  label="Traduci in"
                  onChange={setTargetLanguage}
                  options={translationLanguages.filter(([value]) => value !== sourceLanguage)}
                  value={targetLanguage}
                />
                <SelectField
                  label="Tipo di PDF"
                  onChange={(value) => setTranslationMode(value as "translated" | "bilingual")}
                  options={[
                    ["translated", "Solo traduzione"],
                    ["bilingual", "PDF bilingue"],
                  ]}
                  value={translationMode}
                />
              </>
            ) : (
              <>
                {intent === "transcribe" ? (
                  <SelectField
                    label="Lingua audio"
                    onChange={setLanguage}
                    options={languages}
                    value={language}
                  />
                ) : null}
                <SelectField
                  label="Formato risultato"
                  onChange={setOutputFormat}
                  options={intentFormats[intent]}
                  value={outputFormat}
                />
              </>
            )}
          </div>

          <div className="run-summary">
            <span>
              File <strong>{selected.size}</strong>
            </span>
            <span>
              Concorrenza <strong>max {bridge.batchParallelism}</strong>
            </span>
            <span>
              Sorgenti <strong>{selectedQuickCount ? `${selectedQuickCount} temporanei` : "Libreria"}</strong>
            </span>
          </div>
          <button
            className="button button-primary run-button"
            disabled={!selected.size || !bridge.available || starting}
            onClick={start}
            type="button"
          >
            <Sparkles size={17} />
            {starting
              ? "Preparazione del batch…"
              : `Avvia ${selected.size || ""} ${selected.size === 1 ? "lavoro" : "lavori"}`}
          </button>
          <p className="config-note">
            Gli originali non vengono modificati. I file rapidi non entrano nel database;
            le copie di trasferimento vengono eliminate anche in caso di errore o annullamento.
          </p>
        </div>
      </section>
    </div>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: ReadonlyArray<readonly [string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="select-field">
      <span>{label}</span>
      <select onChange={(event) => onChange(event.target.value)} value={value}>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>{optionLabel}</option>
        ))}
      </select>
    </label>
  );
}
