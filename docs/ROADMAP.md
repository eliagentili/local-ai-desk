# Roadmap

La roadmap è ordinata per dipendenze: affidabilità e osservabilità vengono prima
del numero di funzioni. Ogni fase deve poter essere distribuita e testata da
sola.

## F0 — Foundation desktop

Stato: **completata nella 0.1**.

- shell Tauri/React e design system;
- database, libreria, import multiplo e deduplicazione;
- coda persistente iniziale;
- diagnostica del dispositivo e rilevamento dei motori v1;
- documentazione di prodotto, architettura e sicurezza;
- build macOS riproducibile.

## F0.5 — Portabilità desktop

Stato: **completata nella 0.3 per macOS Apple Silicon e Windows x64**.

- shell, filesystem reveal e process lifecycle multipiattaforma;
- runtime in background senza Terminal/PowerShell visibile;
- dati scrivibili separati dalle risorse installate;
- bootstrap locale dei sette motori per entrambe le piattaforme;
- matrix CI con test Python/Rust e artifact `.app`, `.dmg`, `.exe`, `.msi`;
- icone native ICNS/ICO e installer per utente senza privilegi amministrativi.

Restano necessari firma/notarizzazione Apple e certificato Authenticode prima
di distribuire pubblicamente gli installer.

La migrazione compatibile del database e il recovery dei lavori interrotti sono
stati aggiunti nella 0.2. Log locale redatto e recovery avanzato restano attività
trasversali prima della 1.0.

## F1 — Job engine affidabile

Stato: **prima release utilizzabile nella 0.2**.

- adapter versionato verso i motori esistenti;
- scheduler resource-aware per CPU, memoria, acceleratore e termiche;
- concorrenza per motore e backpressure globale;
- progresso a eventi per file e per batch; **completato**;
- annulla e annulla tutto; **completato**;
- risultati atomici e ZIP batch; **completato**;
- upload in streaming e limite globale di tre lavori; **completato**;
- pausa, riprendi e retry; **da completare**;
- scheduler adattivo a memoria e termiche; **da completare**;
- notifiche native e cronologia eventi visibile; **da completare**.

Questa fase porta nella v2 tutte le capacità già presenti nella v1 senza
regressioni.

## F2 — Studio universale

- anteprima PDF, immagine, audio/video e testo;
- azioni contestuali determinate da formato e intento;
- confronto prima/dopo e versioni del risultato;
- OCR con correzione visuale e confidenza;
- traduzione con glossari, memoria locale e layout preservato;
- trascrizione con speaker, capitoli, sottotitoli ed editor sincronizzato;
- esportazioni PDF, DOCX, Markdown, HTML, JSON, SRT e VTT.

## F3 — Libreria e ricerca

- risultati come elementi di prima classe e relazioni tra derivati;
- collezioni, tag, stelle, note e smart folder;
- ricerca full-text locale e filtri salvati;
- ricerca semantica opzionale con embedding locale;
- duplicati, retention, backup e restore;
- Quick Look/preview, drag & drop e integrazione Finder/Explorer/Share Sheet.

## F4 — Workflow e automazioni

- builder visuale con nodi tipizzati;
- preset condivisibili e versionati;
- cartelle sorvegliate, regole e pianificazione;
- variabili, condizioni, fallback e human-in-the-loop;
- webhook o API locale disattivati per default;
- log di esecuzione riproducibile e modalità dry-run.

## F5 — Model packs e distribuzione pubblica

- catalogo firmato con licenza, provenienza e dimensione;
- installazione, verifica checksum, update e rollback;
- benchmark iniziale sul dispositivo e profili Eco/Bilanciato/Max;
- onboarding guidato e download selettivo;
- aggiornamenti firmati dell'app;
- notarizzazione macOS, firma Windows, SBOM, vulnerability scan e release notes;
- localizzazioni italiana e inglese complete.

## F6 — Estensioni, dopo la stabilità

- SDK di plugin con permessi dichiarativi e sandbox;
- integrazioni opzionali con app locali;
- funzioni cloud opt-in, separate e riconoscibili, solo se utili;
- pack community con revisione e firma.

## Criteri di rilascio pubblico 1.0

- nessuna perdita o sovrascrittura silenziosa di file;
- annullamento verificato per ogni motore;
- recovery dopo force quit e spazio disco esaurito;
- test su PDF grandi/scansionati, video multi-GB e batch misti;
- VoiceOver e sola tastiera sui flussi principali;
- privacy audit, threat model e inventario licenze pubblicati;
- crash-free rate e tempi di avvio misurati su Apple Silicon e PC Windows.
