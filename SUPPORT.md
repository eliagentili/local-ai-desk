# Supporto

Local AI Desk è mantenuta da **una persona**, nel tempo che avanza, senza contratto
di assistenza. Questa pagina dice dove scrivere, cosa allegare e quanto è
realistico aspettare. I tempi qui sotto sono impegni **best-effort**: sono scritti
per essere rispettati, non per fare bella figura.

---

## Prima di scrivere

Molte segnalazioni si risolvono in queste quattro pagine:

| Problema | Dove guardare |
| --- | --- |
| macOS o Windows bloccano l'installazione | [docs/INSTALL.md](docs/INSTALL.md) |
| L'app non parte, i motori non partono, l'installazione si ferma | [README.md](README.md), sezione sul runtime locale |
| «Questo lo fa?» | [README.md](README.md) per ciò che c'è, [docs/ROADMAP.md](docs/ROADMAP.md) per ciò che non c'è |
| Dove finiscono i miei dati | [PRIVACY.md](PRIVACY.md) e [docs/PRIVACY_AUDIT.md](docs/PRIVACY_AUDIT.md) |

Cerca poi fra le
[issue esistenti, anche chiuse](https://github.com/eliagentili/local-ai-desk/issues?q=is%3Aissue):
un commento su una issue aperta è più utile di un duplicato, perché tiene insieme
i casi.

---

## Canali

| Cosa | Dove | Prima risposta (best-effort) |
| --- | --- | --- |
| **Bug**, comportamento sbagliato, crash | [Nuova issue → «Segnala un bug»](https://github.com/eliagentili/local-ai-desk/issues/new/choose) | entro **5 giorni lavorativi** |
| **Barriera di accessibilità** | Issue con etichetta `accessibility`, seguendo [docs/ACCESSIBILITY.md](docs/ACCESSIBILITY.md#5-segnalare-una-barriera) | entro **5 giorni lavorativi** |
| **Vulnerabilità di sicurezza** | [Segnalazione privata](https://github.com/eliagentili/local-ai-desk/security/advisories/new) — **mai** una issue pubblica | entro **3 giorni lavorativi**; dettagli e finestra di divulgazione in [SECURITY.md](SECURITY.md) |
| **Richiesta di funzionalità** | Issue, dopo aver controllato la [roadmap](docs/ROADMAP.md) | nessun tempo dichiarato: vengono lette, non necessariamente accolte |
| **Contribuire con codice** | [CONTRIBUTING.md](CONTRIBUTING.md) | — |

Non ci sono canali di supporto via email, chat, telefono o social. Una richiesta
che arriva altrove non ha modo di essere tracciata e finisce persa: usa le issue.

**Cosa significa best-effort, in concreto.** «Prima risposta» significa che
qualcuno ha letto la segnalazione e dice cosa ne pensa: non che il difetto è
corretto. Non c'è impegno su quando una correzione viene pubblicata, e non c'è
copertura fuori dai giorni lavorativi. Se sono in ferie o influenzato, la risposta
arriva dopo: se una segnalazione resta senza risposta oltre il doppio del tempo
dichiarato, aggiungi un commento — non è maleducazione, è utile.

---

## Versioni supportate

Riceve correzioni **soltanto l'ultima versione pubblicata**. Non esistono rami di
manutenzione per le versioni precedenti: prima di segnalare un bug, aggiorna e
verifica che si presenti ancora.

L'app controlla da sola le nuove versioni e propone l'aggiornamento; il controllo
si disattiva da **Impostazioni**. La versione installata è in fondo alla barra
laterale.

---

## Cosa allegare a una segnalazione

Con queste sei informazioni una segnalazione è diagnosticabile. Senza, la prima
risposta è una richiesta di informazioni e si perde un giro.

1. **Versione dell'app** (in fondo alla barra laterale).
2. **Sistema operativo e versione** (per esempio «macOS 15.3, Apple M2» oppure
   «Windows 11 23H2, x64»).
3. **Cosa hai fatto**, passo per passo, dall'apertura dell'app in poi.
4. **Cosa ti aspettavi** e **cosa è successo invece**.
5. **Il messaggio d'errore per intero**, copiato come testo. Se è troncato, dillo.
6. **Tipo, dimensione approssimativa e provenienza del file** che stavi
   elaborando: «PDF scansionato di 340 pagine, ~80 MB, da uno scanner Canon». Il
   tipo di file spiega molti difetti; il file no.

Se il problema riguarda i motori o l'installazione, può servire un estratto di
`install.log` o `runtime.log`, che raggiungi da **Modelli**. **Non allegarli
d'istinto**: leggi il paragrafo qui sotto prima.

---

## Cosa non allegare mai

**Non allegare i tuoi documenti.** Né l'originale, né il risultato, né uno
screenshot che ne mostri il contenuto, né un ritaglio. Nessuna segnalazione ne ha
bisogno: se davvero serve un file per riprodurre il difetto, viene chiesto un
**file di esempio costruito da zero** che mostri lo stesso comportamento, e va
allegato solo dopo che è stato chiesto.

Una issue su GitHub è **pubblica, indicizzata e permanente**. Cancellare un
allegato non lo ritira da chi l'ha già scaricato o da una cache.

Prima di allegare un log, aprilo e leggilo. Il contenuto dei documenti non finisce
mai nei log, ma **il nome di un file può comparire dentro il testo di un errore** e
i percorsi contengono il nome del tuo account (vedi
[docs/PRIVACY_AUDIT.md](docs/PRIVACY_AUDIT.md)). Quindi:

- incolla **soltanto le righe che riguardano l'errore**, non il file intero;
- sostituisci nomi di file e percorsi con `documento.pdf` e `/Users/utente/…`,
  mantenendo l'estensione, che è la parte diagnostica;
- se non sei sicuro che una riga sia innocua, togli quella riga.

**Non allegare mai**: dati personali di terzi, credenziali o token di qualunque
tipo, il contenuto della cartella dati dell'app, il database
`local-ai-desk.sqlite3` (contiene i nomi e i percorsi di tutto ciò che hai
elaborato).

Una segnalazione con meno informazioni è correggibile con una domanda in più. Un
documento pubblicato per sbaglio non è correggibile.

---

## Se la segnalazione riguarda la sicurezza

Non aprire una issue. Usa la
[segnalazione privata](https://github.com/eliagentili/local-ai-desk/security/advisories/new)
e leggi [SECURITY.md](SECURITY.md) per i tempi e la finestra di divulgazione
coordinata. Vale anche per un dubbio: un sospetto in privato non costa nulla, un
dettaglio in pubblico non si ritira.

Prima di segnalare, controlla i
[rischi accettati del modello di minaccia](docs/THREAT_MODEL.md#rischi-accettati):
alcune cose che sembrano difetti sono limiti dichiarati, e la risposta sarebbe un
rimando a quel documento.

---

## Cosa non è supporto

Per essere chiari su cosa non aspettarsi, invece di lasciarlo scoprire:

- **nessuna assistenza sul contenuto dei tuoi documenti** o sulla qualità di una
  traduzione, di una trascrizione o di un mascheramento in un caso specifico: i
  motori sono di terzi e i loro limiti sono i loro;
- **nessuna consulenza di conformità.** L'app elabora sul dispositivo, e questo è
  un fatto tecnico verificabile in [docs/PRIVACY_AUDIT.md](docs/PRIVACY_AUDIT.md);
  se sia sufficiente per il tuo obbligo normativo lo decidi tu con chi ti assiste;
- **nessun supporto su installazioni modificate**: motori installati a mano,
  variabili d'ambiente cambiate, build compilate da un fork;
- **nessuna garanzia**: la licenza è AGPL-3.0-or-later e il software è fornito
  «così com'è» ([LICENSE](LICENSE)).
