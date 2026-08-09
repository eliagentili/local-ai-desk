import {
  ArrowUpRight,
  Check,
  FileSearch,
  Languages,
  Mic2,
  PlugZap,
  ScanText,
  ShieldCheck,
  Sparkles,
  UploadCloud,
} from "lucide-react";
import type { ComponentType } from "react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import { foldForSearch, formatBytes } from "../lib/format";
import {
  engineGate,
  engineName,
  intentDescriptions,
  intentFormats,
  intentLabels,
  intentOrder,
  languageNames,
} from "../lib/strings";
import type {
  BridgeStatus,
  LibraryItem,
  SectionId,
  WorkflowIntent,
  WorkflowOptions,
} from "../types";

const intentIcons: Record<WorkflowIntent, ComponentType<{ size?: number }>> = {
  extract: Sparkles,
  translate: Languages,
  ocr: ScanText,
  transcribe: Mic2,
  privacy: ShieldCheck,
};

const translationLanguages = languageNames.filter(([value]) => value !== "auto");

/** Engine that has to be ready for an intent to produce a real result. `extract`
 *  routes at run time and `privacy` degrades to local rules, so neither is here. */
const intentEngine: Partial<Record<WorkflowIntent, string>> = {
  translate: "pdf-translate",
  ocr: "paddleocr",
  transcribe: "faster-whisper",
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
  onNavigate: (section: SectionId) => void;
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
  onNavigate,
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
  const deferredQuery = useDeferredValue(foldForSearch(query.trim()));
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
        foldForSearch(`${item.name} ${item.kind}`).includes(deferredQuery),
      ),
    [compatible, deferredQuery],
  );
  const selectedQuickCount = Array.from(selected).filter(
    (id) => itemById.get(id)?.status === "temporary",
  ).length;
  const requiredEngine = useMemo(() => {
    const engineId = intentEngine[intent];
    if (!engineId) return null;
    return bridge.engines.find((engine) => engine.id === engineId) ?? null;
  }, [bridge.engines, intent]);
  const engineBlocked = Boolean(
    bridge.available && requiredEngine && requiredEngine.state !== "ready",
  );
  const blockedMessage =
    engineBlocked && requiredEngine
      ? `${engineName(requiredEngine.id)} non è pronto: ${requiredEngine.label}. Completa l’installazione da Modelli prima di avviare questo tipo di lavoro.`
      : null;

  // Auto-select each dropped file exactly once. Re-running the selection on
  // every render kept undoing the user's own deselection.
  const autoSelected = useRef<Set<string>>(new Set());
  useEffect(() => {
    setSelected((current) => {
      const next = new Set(Array.from(current).filter((id) => itemById.has(id)));
      for (const item of quickItems) {
        if (!autoSelected.current.has(item.id) && supportsIntent(item, intent)) {
          autoSelected.current.add(item.id);
          next.add(item.id);
        }
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
        {bridge.available ? (
          <span className="large-status" data-ready>
            <span className="status-dot" />
            fino a {bridge.batchParallelism} lavori in parallelo
          </span>
        ) : null}
      </section>

      {/* A chip that only stated "motori non avviati" left the user in front of a
          disabled button with nowhere to go: this block is the way out. */}
      {bridge.available ? null : (
        <button className="engine-gate" onClick={() => onNavigate("models")} type="button">
          <span className="engine-gate-icon" aria-hidden="true"><PlugZap size={20} /></span>
          <span>
            <strong>{engineGate.title}</strong>
            <small>{engineGate.detail}</small>
          </span>
          <span className="engine-gate-action">
            {engineGate.action}
            <ArrowUpRight size={15} />
          </span>
        </button>
      )}

      <section className="intent-grid" aria-label="Scegli il risultato">
        {intentOrder.map((id) => {
          const Icon = intentIcons[id];
          return (
            <button
              aria-pressed={intent === id}
              className="intent-card"
              data-active={intent === id}
              key={id}
              onClick={() => chooseIntent(id)}
              type="button"
            >
              <span className="intent-icon"><Icon size={19} /></span>
              <strong>{intentLabels[id]}</strong>
              <p>{intentDescriptions[id]}</p>
              {intent === id ? <Check className="intent-check" size={15} /> : null}
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
          <h3>{intentLabels[intent]}</h3>
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
                    options={languageNames}
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
            disabled={!selected.size || !bridge.available || engineBlocked || starting}
            onClick={start}
            type="button"
          >
            <Sparkles size={17} />
            {starting
              ? "Preparazione del batch…"
              : `Avvia ${selected.size || ""} ${selected.size === 1 ? "lavoro" : "lavori"}`}
          </button>
          {blockedMessage ? <p className="config-blocked">{blockedMessage}</p> : null}
          {/* The live region is mounted with the view and filled when the block
              appears. Rendering region and text together, as before, meant
              assistive technology never saw it empty and never announced it. */}
          <span aria-live="polite" className="sr-only" role="status">
            {blockedMessage ?? ""}
          </span>
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
