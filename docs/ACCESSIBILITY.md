# Accessibilità

**Stato al 9 agosto 2026, versione 1.0.0.**

> **Nessuno dei flussi di questa app è stato percorso con uno screen reader.**
> L'impianto tecnico descritto al §1 è implementato e verificabile nel codice.
> La verifica con VoiceOver, con Narrator o NVDA e con la sola tastiera **non è
> stata eseguita**. Il §3 definisce cosa va certificato e come; il §4 è la
> tabella dove l'esito va registrato, e oggi è vuota.
>
> Questa distinzione è il punto del documento. Un elenco di attributi ARIA non è
> una prova che l'app sia usabile senza vedere lo schermo.

---

## 1. Cosa è implementato

Ogni riga è verificabile nel codice indicato.

### Struttura e navigazione

| Cosa | Dove |
| --- | --- |
| Skip link verso il contenuto principale, primo elemento focalizzabile della pagina | `src/App.tsx` (`.skip-link` → `#main-content`); stile a `src/App.css` (`.skip-link`, visibile solo su `:focus-visible`) |
| `<main>` focalizzabile con `tabIndex={-1}`, così il salto porta il focus e non solo lo scorrimento | `src/App.tsx` (`<main id="main-content" tabIndex={-1}>`) |
| `aria-busy` sul contenuto principale durante il caricamento | `src/App.tsx` (`<main aria-busy={loading}>`) |
| `aria-current="page"` sulla voce di sidebar attiva | `src/components/Sidebar.tsx` (attributo sul pulsante di navigazione) |
| `aria-pressed` sui selettori di obiettivo, che sono interruttori e non link | `src/components/StudioView.tsx` (pulsanti degli obiettivi) |
| Lingua del documento dichiarata | `index.html` (`<html lang="it">`) |
| Nessun elemento cliccabile che non sia un `<button>` o un controllo nativo, in tutti i componenti | verificabile con `grep -rn 'onClick' src/` |
| Nessuna trappola di focus: l'app non ha finestre modali | scelta di progetto da preservare |

### Annunci

| Cosa | Dove |
| --- | --- |
| Il contenitore del toast è montato sempre e riempito quando serve, perché una live region inserita insieme al proprio testo non viene annunciata | `src/App.tsx` (commento e `<div aria-live="polite" role="status">`) |
| Due live region separate invece di una, così un'azione non riannuncia il conteggio dei lavori | `src/App.tsx` (le due `<span aria-live="polite" className="sr-only">` in fondo) |
| Stato di caricamento annunciato con `role="status"` | `src/App.tsx` (`.loading-state`) |
| Schermata di crash annunciata con `role="alert"` | `src/components/ErrorBoundary.tsx` (`.crash-screen`) |

### Progresso

| Cosa | Dove |
| --- | --- |
| `role="progressbar"` con `aria-valuenow/min/max` quando la percentuale è reale | `src/components/ActivityView.tsx` (blocco `.progress-track`), `src/components/ModelsView.tsx`, `src/components/SettingsView.tsx` |
| Gli stessi attributi **omessi** quando il progresso è indeterminato, invece di dichiarare uno zero falso, con `aria-label` che lo dice a parole | `src/components/ActivityView.tsx` (`indeterminate ? undefined : …`) |

### Tastiera e movimento

| Cosa | Dove |
| --- | --- |
| Il drag & drop ha un equivalente da tastiera: la zona di rilascio è un `<button>` che apre il selettore file | `src/components/StudioView.tsx` (`.studio-drop-zone`) |
| Scorciatoie native: `Cmd/Ctrl+O` apre il Drop rapido, `Cmd/Ctrl+Shift+O` importa in Libreria, `Cmd/Ctrl+,` apre Impostazioni, `Esc` chiude il messaggio | `src/App.tsx` (handler `onKeyDown`) |
| Anello di focus a doppio contorno, visibile sia sul canvas chiaro sia sulla sidebar scura | `src/App.css` (blocco `:focus-visible` e override `.sidebar :focus-visible`) |
| `prefers-reduced-motion: reduce` esteso anche agli effetti di hover e pressione, non solo alle transizioni | `src/App.css` (blocco `@media (prefers-reduced-motion: reduce)`) |
| Il contenuto scorre dentro `.main-content` con `overscroll-behavior: contain`: ingrandire il testo non taglia il contenuto | `src/App.css` (`.main-content`) |

### Contrasto

Tutti i colori, compresi quelli di stato, passano da token definiti in `:root` di
`src/App.css` e rimappati nel blocco `@media (prefers-color-scheme: dark)`:
`--state-ok-*`, `--state-warn-*`, `--state-error-*`, `--state-info-*`,
`--icon-accent`, `--control-border`, `--track-bg`, `--track-fill`. Nessun colore
letterale vive fuori da quei due blocchi, quindi il tema scuro non può lasciare
indietro un valore.

Il requisito misurabile è: testo ≥ 4.5:1 sul proprio fondo **in entrambi i temi**,
bordi e riempimenti di controllo ≥ 3:1. Il rapporto di ogni token viene ricalcolato
da `scripts/check-contrast.mjs`, eseguito in CI, che fallisce sotto soglia.

Il contrasto è quindi **misurato**, non stimato. Resta non verificato tutto ciò
che una misura non cattura: ordine di lettura, annunci mancanti, focus che si
perde.

---

## 2. Cosa non è verificato

- **Sessione con VoiceOver su macOS 14 o successivo.** Nessuna.
- **Sessione con Narrator o NVDA su Windows 10/11.** Nessuna.
- **Percorso completo con la sola tastiera, puntatore fisicamente staccato.**
  Nessuno.
- **Modalità Alto contrasto di Windows.** Il blocco
  `@media (forced-colors: active)` di `src/App.css` ridisegna con i colori di
  sistema i controlli che il browser non può ripitturare da sé: caselle di
  selezione, interruttori, barre di avanzamento, indicatore della voce di
  navigazione attiva, pallini di stato e contorno della scheda selezionata.
  **Non è stato provato su un Windows con Alto contrasto attivo**: è un
  adeguamento scritto, non verificato.
- **Ingrandimento del testo del sistema oltre il 100%.** Non provato. La
  tipografia dell'app non ha una scala regolabile dall'utente.
- **Nessun controllo automatico di accessibilità nei workflow** (axe, pa11y,
  Lighthouse): il gate di contrasto copre i token di colore, non il DOM.

Difetti già noti per lettura del codice, che una sessione reale renderebbe
evidenti:

1. Il cambio di vista non sposta il focus: chi naviga da tastiera resta sulla
   voce di sidebar e deve ripercorrere l'interfaccia per raggiungere il nuovo
   contenuto.
2. Alcuni contenitori di annuncio compaiono nel DOM già pieni di testo — per
   esempio l'avviso che il server dei modelli accetta connessioni dalla rete in
   `src/components/ModelsView.tsx` e il messaggio di configurazione bloccata in
   `src/components/StudioView.tsx` — quindi non vengono annunciati.
3. Il pannello degli aggiornamenti aggiorna la percentuale molte volte al secondo
   dentro una live region: uno screen reader la ripete senza sosta.

---

## 3. I tre flussi da certificare, e il protocollo

Non tutta l'interfaccia: i tre percorsi senza i quali il prodotto non serve a
nulla. Se uno di questi non è percorribile, l'app non è accessibile,
indipendentemente dal resto.

### Flusso A — Dal file al risultato

Aggiungere un file, scegliere l'obiettivo, avviare, capire com'è andata,
raggiungere il risultato.

Passi: aprire l'app → aggiungere un file (Drop rapido **da tastiera**, senza
trascinare) → aprire Studio → scegliere l'obiettivo → configurare le opzioni
richieste → avviare → seguire l'avanzamento → riconoscere l'esito → raggiungere e
aprire il risultato.

### Flusso B — Installazione dei motori

Il primo avvio: capire che i motori non ci sono, avviare l'installazione, sapere
a che punto è, sapere che è finita o che è fallita e perché.

Passi: avvio a runtime assente → raggiungere Modelli → leggere requisiti e spazio
richiesto → avviare l'installazione → percepire l'avanzamento per fasi →
riconoscere il completamento o l'errore → eventualmente annullare.

### Flusso C — Aggiornamento dell'app

Passi: notifica di aggiornamento disponibile → raggiungere il pannello →
leggere versione e note → avviare il download → percepire l'avanzamento senza
esserne sommersi → riavviare.

### Protocollo

Ogni flusso va percorso **tre volte**, una per configurazione:

| Configurazione | Requisiti |
| --- | --- |
| **K** — sola tastiera | Puntatore fisicamente scollegato o disabilitato. Nessun clic. |
| **V** — VoiceOver | macOS 14 o successivo. `Cmd+F5`. Schermo spento o coperto per l'intera sessione. |
| **N** — Narrator o NVDA | Windows 10 o 11. `Ctrl+Win+Invio` per Narrator, oppure NVDA. Schermo spento o coperto. |

Regole della sessione, valide per tutte e tre:

1. **Partire da uno stato pulito**: profilo utente nuovo o cartella dati rimossa,
   così il primo avvio è davvero il primo avvio.
2. **Un solo operatore, senza aiuto visivo.** Se serve guardare lo schermo per
   proseguire, il passo è **bloccato**, non «faticoso».
3. **Registrare a voce o per iscritto ogni passo**, annotando: cosa è stato
   annunciato, cosa è stato taciuto, dove il focus è finito dopo ogni azione.
4. Un flusso è **superato** solo se: nessun passo è bloccato; ogni cambiamento di
   stato viene annunciato entro pochi secondi; il focus dopo ogni azione è
   prevedibile; nessun annuncio si ripete in modo da coprire gli altri.
5. Un flusso è **superato con riserve** se è completabile ma almeno un annuncio
   manca o il focus si perde. La riserva va descritta, non arrotondata.
6. **Ogni difetto diventa una issue**, con il flusso, la configurazione, il passo
   e l'annuncio atteso. Il numero della issue va in tabella.

Esito atteso perché una release possa dichiararsi accessibile: nove sessioni
(tre flussi × tre configurazioni) registrate, nessuna con un passo bloccato.

---

## 4. Registro delle verifiche

Da compilare eseguendo il protocollo del §3. **Oggi è vuota: nessuna sessione è
stata eseguita.**

| Data | Versione | Flusso | Config. | Sistema operativo | Screen reader e versione | Esito | Issue aperte | Operatore |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| | | A | K | | — | | | |
| | | A | V | | | | | |
| | | A | N | | | | | |
| | | B | K | | — | | | |
| | | B | V | | | | | |
| | | B | N | | | | | |
| | | C | K | | — | | | |
| | | C | V | | | | | |
| | | C | N | | | | | |

Valori ammessi nella colonna **Esito**: `superato`,
`superato con riserve (descrivere)`, `non superato (passo bloccato: …)`.

Righe da aggiungere, non da sovrascrivere: la storia delle verifiche serve a
vedere se una regressione è tornata.

---

## 5. Segnalare una barriera

Se qualcosa è inutilizzabile con la tua tecnologia assistiva, apri una issue con
l'etichetta `accessibility` indicando: sistema operativo, screen reader e
versione, il flusso, il passo esatto e cosa ti aspettavi di sentire. Vale come
bug, non come richiesta di funzionalità. Canali e regole in
[../SUPPORT.md](../SUPPORT.md).
