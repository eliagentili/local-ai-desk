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

Nella 1.0 il database dichiara la propria versione di schema (`PRAGMA
user_version`) e rifiuta con un messaggio azionabile un archivio scritto da una
versione più recente dell'app, invece di aprirlo e leggerlo a metà. Le migrazioni
restano solo additive.

## F0.5 — Portabilità desktop

Stato: **completata nella 0.3 per macOS Apple Silicon e Windows x64**.

- shell, filesystem reveal e process lifecycle multipiattaforma;
- runtime in background senza Terminal/PowerShell visibile;
- dati scrivibili separati dalle risorse installate;
- bootstrap locale dei sette motori per entrambe le piattaforme;
- matrix CI con test Python/Rust e artifact `.app`, `.dmg`, `.exe`, `.msi`;
- icone native ICNS/ICO e installer per utente senza privilegi amministrativi.

**Firma Developer ID/notarizzazione Apple e certificato Authenticode Windows sono
fuori dalla 1.0 in modo permanente.** Non sono un lavoro rimandato: Local AI Desk
è gratuito e senza entrate, e i due programmi costano insieme centinaia di euro
all'anno di abbonamenti e certificati su hardware conforme. La 1.0 esce con firma
ad-hoc su macOS e senza firma su Windows. La conseguenza — il blocco di Gatekeeper
al primo avvio, l'avviso di SmartScreen, i permessi macOS da riconcedere dopo un
aggiornamento — è spiegata passo per passo in [INSTALL.md](INSTALL.md) e ripetuta
in README, note di rilascio e [THREAT_MODEL.md](THREAT_MODEL.md). Se in futuro il
progetto avrà una fonte di finanziamento, la firma rientra; finché non l'ha,
resta un limite dichiarato e non una casella aperta.

La migrazione compatibile del database e il recovery dei lavori interrotti sono
stati aggiunti nella 0.2. Nella 1.0 il recovery ha un test che asserisce il
passaggio da `running` a `interrupted` al riavvio, e l'app scrive un proprio log
locale in append con rotazione, un hook sui panic, il tempo fino al primo
snapshot e un marcatore di chiusura pulita.

## F1 — Job engine affidabile

Stato: **completata e indurita nella 1.0** (prima release utilizzabile nella 0.2),
con due voci spostate fuori perimetro.

- adapter versionato verso i motori esistenti; **completato**;
- concorrenza per motore e backpressure globale; **completato**;
- progresso a eventi per file e per batch; **completato**;
- annulla e annulla tutto; **completato** e, dalla 1.0, realmente interrompente
  su tutti e sei i motori: markitdown, docling e Privacy Shield girano in
  processi figli terminabili come già faceva la traduzione PDF, con un test per
  motore che asserisce l'eccezione di annullamento, nessun processo residuo e il
  semaforo rilasciato;
- risultati atomici e ZIP batch; **completato**. Dalla 1.0 un output assente,
  vuoto o di soli spazi è un errore prima che venga creato un file: nessun
  percorso può più produrre un lavoro `completed` con un risultato da 0 byte;
- upload in streaming e limite globale di tre lavori; **completato**;
- drag & drop rapido senza persistenza delle sorgenti e con pulizia automatica;
  **completato**;
- retry di un lavoro non riuscito, con fonte in Libreria; **completato**;
- cronologia eventi visibile; **completata nella 1.0**: dettaglio espandibile per
  lavoro in Attività, con fase, stato, messaggio e copia negli appunti;
- notifiche native; **fuori dalla 1.0**: il plugin non faceva più partire il
  binario di test su Windows (`STATUS_ENTRYPOINT_NOT_FOUND`), non verificabile
  senza una macchina Windows, ed è stato rimosso dal codice; a batch concluso
  l'esito si legge in Attività;
- tetto di durata per lavoro; **completato nella 1.0**: dodici ore per default,
  configurabile, con risposta azionabile invece di un lavoro appeso per sempre;
- pausa e riprendi; **fuori dalla 1.0**, rinviata a dopo la stabile;
- scheduler adattivo a memoria e termiche; **fuori dalla 1.0**: la concorrenza
  resta fissa a tre lavori e non si adatta alla RAM disponibile.

## F2 — Studio universale

Stato: **non iniziata, post-1.0.**

- anteprima PDF, immagine, audio/video e testo;
- azioni contestuali determinate da formato e intento;
- confronto prima/dopo e versioni del risultato;
- OCR con correzione visuale e confidenza;
- traduzione con glossari, memoria locale e layout preservato;
- trascrizione con speaker, capitoli, sottotitoli ed editor sincronizzato;
- esportazioni PDF, DOCX, Markdown, HTML, JSON, SRT e VTT. La 1.0 esporta
  Markdown, testo, SRT, JSON e PDF tradotto: DOCX, HTML e VTT sono qui.

## F3 — Libreria e ricerca

Stato: **non iniziata, post-1.0.** La 1.0 elenca e filtra le fonti per nome e
tipo; tutto il resto di questa fase manca.

- risultati come elementi di prima classe e relazioni tra derivati;
- collezioni, tag, stelle, note e smart folder;
- ricerca full-text locale e filtri salvati;
- ricerca semantica opzionale con embedding locale;
- duplicati, retention, backup e restore;
- Quick Look/preview e integrazione Finder/Explorer/Share Sheet. Il drag & drop
  rapido multipiattaforma è disponibile dalla 0.4.

## F4 — Workflow e automazioni

Stato: **non iniziata, post-1.0.** La voce «Workflow» è stata rimossa
dall'interfaccia nella 1.0: era una sezione segnaposto di primo livello che
prometteva una superficie inesistente.

- builder visuale con nodi tipizzati;
- preset condivisibili e versionati;
- cartelle sorvegliate, regole e pianificazione;
- variabili, condizioni, fallback e human-in-the-loop;
- webhook o API locale disattivati per default;
- log di esecuzione riproducibile e modalità dry-run.

## F5 — Model packs e distribuzione pubblica

Stato: **parziale.**

- catalogo firmato con licenza, provenienza e dimensione; **parziale**: i pack
  dichiarano dimensione e origine, non ancora revisione e licenza per pack;
- installazione, verifica checksum, update e rollback; **parziale**: gli asset di
  bootstrap sono verificati per SHA-256 e i pack pubblicati in modo atomico da
  una cartella di staging; l'update e il rollback di un singolo pack no;
- benchmark iniziale sul dispositivo e profili Eco/Bilanciato/Max; **fuori dalla
  1.0**;
- onboarding guidato e download selettivo; **completato nella 1.0**: la prima
  apertura mostra cosa fa l'app, i cinque obiettivi, lo spazio richiesto e quello
  libero, e rifiuta l'installazione sotto soglia prima di scaricare qualsiasi
  cosa; l'installazione mostra la fase corrente e si può annullare;
- aggiornamenti firmati dell'app; **completati dalla 0.5**. La procedura di
  rollback è scritta in [RELEASING.md](RELEASING.md) ma **non è ancora stata
  eseguita su macchine pulite**: resta un limite dichiarato della 1.0;
- notarizzazione macOS e firma Windows; **permanentemente fuori** (vedi F0.5);
- SBOM, vulnerability scan e release notes; **completati**. Dalla 1.0 l'SBOM
  identifica l'applicazione con la versione giusta e cataloga anche i pacchetti
  dei lock, e l'inventario licenze è generato dai lock invece di essere scritto a
  mano;
- localizzazioni italiana e inglese complete; **fuori dalla 1.0**: l'interfaccia
  è solo in italiano. Il debito è stato disinnescato (stringhe estratte, locale
  parametrica, nessun confronto su etichette italiane) ma la traduzione non è
  fatta.

## F6 — Estensioni, dopo la stabilità

Stato: **non iniziata, post-1.0.**

- SDK di plugin con permessi dichiarativi e sandbox;
- integrazioni opzionali con app locali;
- funzioni cloud opt-in, separate e riconoscibili, solo se utili;
- pack community con revisione e firma.

## Perimetro della 1.0

**La 1.0 è F0 + F0.5 + F1 completate e indurite. F2, F3, F4 e F6 sono
esplicitamente post-1.0; F5 entra solo per le parti elencate sopra.** Serve a
evitare l'equivoco per cui «1.0» significa «tutto quello che c'è in roadmap».

### Dentro la 1.0

- i cinque obiettivi con i loro motori locali: estrazione, traduzione PDF, OCR,
  trascrizione, mascheramento dei dati personali;
- Drop rapido e Libreria come due corsie distinte, con la conservazione come
  scelta esplicita;
- coda persistente, tre lavori concorrenti, limite per motore, annullamento per
  lavoro e per batch, retry dalla Libreria, recovery dei lavori interrotti;
- annullamento realmente interrompente su tutti e sei i motori, con test;
- nessun risultato vuoto dichiarato completato, in nessun percorso;
- primo avvio che porta da qualche parte: benvenuto, spazio richiesto e libero,
  fase dell'installazione, annullamento dell'installazione;
- cronologia degli eventi di ogni lavoro, leggibile e copiabile;
- aggiornamenti firmati Ed25519 con verifica prima dell'installazione;
- tema chiaro e scuro con contrasto misurato in CI, alto contrasto di Windows
  gestito sui controlli, focus e annunci per screen reader;
- licenza AGPL e attribuzioni dentro il prodotto distribuito, non solo nel repo;
- inventario licenze generato dai lock, SBOM, checksum, threat model e audit
  privacy pubblicati.

### Dichiarato fuori dalla 1.0

Ognuna di queste voci è ripetuta nei limiti noti del README e delle note di
rilascio, perché una funzione assente va detta prima del download.

- firma del codice su macOS e Windows — **permanentemente**, vedi F0.5;
- pausa e ripresa di un lavoro: si annulla e si riparte da capo;
- scheduler adattivo: la concorrenza è fissa a tre;
- interfaccia in lingue diverse dall'italiano;
- anteprima, editor, confronto prima/dopo, versioni del risultato (F2);
- tag, collezioni, note, ricerca full-text e semantica in Libreria (F3);
- workflow visuali, cartelle sorvegliate, pianificazione (F4);
- export DOCX, HTML e VTT;
- rilevamento automatico della lingua di partenza di un PDF da tradurre;
- eliminazione dei risultati dall'app e retention automatica;
- scelta manuale fra PaddleOCR e GLM-OCR;
- notifiche di sistema a batch concluso e alla prima fallita: rimosse dopo che
  il plugin ha smesso di far partire il binario di test su Windows, non
  verificabile senza una macchina Windows;
- interruttore per la concorrenza e la retention in Impostazioni;
- rimozione o riparazione del runtime dei motori dall'app;
- canali Homebrew cask e winget;
- attestazione di build provenance sugli artefatti;
- rollback dell'aggiornamento eseguito e verificato su macchine pulite;
- sessioni con VoiceOver e NVDA/Narrator: l'impianto c'è e i difetti noti sono
  corretti, ma nessun flusso è stato percorso con uno screen reader reale
  (vedi [ACCESSIBILITY.md](ACCESSIBILITY.md));
- collaudo su disco pieno, force quit e batch multi-GB su macchine reali: i casi
  ostili hanno test automatici, il collaudo manuale su hardware no.

## Criteri di rilascio pubblico 1.0

Stato di ognuno alla 1.0, senza caselle spuntate per fiducia.

| Criterio | Stato |
| --- | --- |
| nessuna perdita o sovrascrittura silenziosa di file | **soddisfatto**: scrittura atomica per rename in ogni formato, output vuoto rifiutato prima di creare il file, guardia finale comune a tutti i motori |
| annullamento verificato per ogni motore | **soddisfatto**: sei motori, un test ciascuno su eccezione, processi residui e semaforo |
| recovery dopo force quit e spazio disco esaurito | **parziale**: il percorso è implementato, testato in automatico e il messaggio di disco pieno arriva all'utente; il collaudo manuale su volume pieno reale non è stato eseguito |
| test su PDF grandi/scansionati, video multi-GB e batch misti | **parziale**: input ostili (zip a espansione elevata, archivi nidificati, PDF troncati e cifrati, estensioni mentite) coperti da test; il batch multi-GB su hardware reale no |
| VoiceOver e sola tastiera sui flussi principali | **parziale**: impianto completo, difetti noti corretti, contrasto misurato in CI; nessuna sessione registrata con uno screen reader |
| privacy audit, threat model e inventario licenze pubblicati | **soddisfatto**: [PRIVACY_AUDIT.md](PRIVACY_AUDIT.md), [THREAT_MODEL.md](THREAT_MODEL.md) e [../THIRD_PARTY_LICENSES.md](../THIRD_PARTY_LICENSES.md) generato dai lock |
| crash-free rate e tempi di avvio misurati su Apple Silicon e PC Windows | **non soddisfatto**: il log applicativo con panic hook e tempo di avvio esiste dalla 1.0, quindi la misura è possibile, ma non è stata condotta su un campione |

I tre criteri parziali e quello non soddisfatto sono il primo lavoro dopo la 1.0.
Nessuno di loro è stato dichiarato chiuso per far uscire la release.
