# Sicurezza

Ultimo aggiornamento: 9 agosto 2026.

Il modello di minaccia completo — asset, attori, mitigazioni con il riferimento al
codice che le implementa e **rischi accettati** — è in
[docs/THREAT_MODEL.md](docs/THREAT_MODEL.md). Questa pagina è il riassunto e il
canale di segnalazione.

## Versioni supportate

| Versione | Correzioni di sicurezza |
| --- | --- |
| Ultima versione pubblicata | Sì |
| Tutte le precedenti | No |

Non esistono rami di manutenzione. Una correzione di sicurezza esce come nuova
release: aggiornare è il modo di riceverla.

## Proprietà applicate

- il frontend non dispone di accesso generico alla shell, alla rete o al
  filesystem: la capability concede un elenco chiuso di permessi, e nessuno di
  essi apre la shell, la rete o il filesystem;
- la Content Security Policy impedisce al frontend qualunque connessione verso un
  host esterno;
- il ponte verso i motori usa un indirizzo loopback fisso, timeout espliciti e un
  token generato a ogni avvio, mai scritto su disco, senza il quale il backend
  rifiuta ogni richiesta;
- il backend rifiuta ogni richiesta che porti un header `Origin`, quindi nessuna
  pagina web aperta nel browser può usare i motori locali;
- backend e server dei modelli vengono avviati senza console e vincolati a
  `127.0.0.1`, e la variabile che pubblicherebbe i modelli sulla rete non viene
  mai ereditata;
- i processi avviati girano in un process group isolato, terminato per intero alla
  chiusura; il motore si spegne da sé se il processo dell'app scompare, e gli
  orfani vengono recuperati al riavvio confrontando il nome dell'eseguibile;
- i risultati vengono scritti su un file parziale e promossi con un rename solo a
  scrittura completata: un lettore non vede mai un output incompleto;
- un output vuoto è un errore, non un risultato;
- i percorsi importati vengono canonicalizzati e devono riferirsi a file reali; le
  operazioni sui file dell'app accettano solo percorsi dentro la cartella dati;
- i file grandi vengono letti e trasferiti a blocchi, non caricati interamente in
  memoria;
- il database abilita foreign key, WAL e timeout in caso di concorrenza, marca lo
  schema con `PRAGMA user_version` e rifiuta un archivio scritto da una versione
  più recente invece di aprirlo perdendo colonne;
- la supply chain è fissata dove il fornitore lo consente: SHA-256 verificati con
  interruzione dell'installazione per gli asset scaricati, wheel Python installati
  con `--require-hashes` dai lock per piattaforma, action di CI fissate per SHA;
- gli aggiornamenti sono firmati Ed25519 e la firma è verificata dall'app contro
  la chiave pubblica compilata nel binario; la CI verifica ogni firma prima di
  pubblicare.

## Limiti dichiarati

Ognuno è argomentato in [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md#rischi-accettati).

- **Nessuna firma del codice.** Gli installer non sono firmati con un certificato
  Apple Developer ID né Authenticode: macOS e Windows avvisano l'utente e
  richiedono un'autorizzazione manuale, l'identità di chi pubblica non è
  verificata da terzi, e non è pubblicata un'attestazione di provenienza. La
  procedura e le conseguenze sono in [docs/INSTALL.md](docs/INSTALL.md).
- **Il confine di sicurezza è l'account utente del sistema operativo.** Documenti,
  risultati, database e log stanno sul disco con i normali permessi dell'utente, e
  il token del motore vive nell'ambiente di un processo figlio. Un programma che
  gira come l'utente ha accesso a tutto: l'app non tenta di difendersene.
- **Il server dei modelli sulla porta 11434 non richiede autenticazione.** Accetta
  solo connessioni locali, ma un altro programma sul computer può usarne le
  risorse o cancellare i pesi condivisi. Nessun documento dell'utente transita da
  quel canale per iniziativa di un terzo.
- **La porta dei motori è fissa.** Un processo già presente su quella porta viene
  adottato solo se accetta il token di questo avvio; altrimenti l'app rifiuta di
  avviare i motori e lo dice. Conseguenza accettata: un programma qualunque, anche
  non ostile, può impedire l'uso dei motori finché non viene chiuso.
- **Parser e motori non sono isolati in sandbox** con limiti rigidi di CPU e
  memoria. Ci sono un tetto di durata per lavoro e limiti di espansione sugli
  archivi, non una sandbox. **Non elaborare file provenienti da fonti non fidate**
  e non aprire output eseguibili senza verificarli.
- **L'analisi statica CodeQL copre JavaScript/TypeScript, Python e i workflow, non
  il Rust**, che CodeQL non supporta in configurazione predefinita. Il core Rust è
  presidiato da `cargo clippy -D warnings` e `cargo test` bloccanti, da
  `cargo audit` sul lockfile e da un solo blocco `unsafe` in tutto il core.
- **I pesi dei modelli non sono fissati per revisione**: arrivano con la garanzia
  che dà il fornitore, non con una del progetto.
- **Nomi di file e percorsi possono comparire nei log locali.** Il log degli
  accessi del motore è disattivato e il nome del file viaggia in un header, ma il
  testo di un errore può nominare il file che l'ha causato e i percorsi
  dell'installazione contengono il nome dell'account. Il contenuto dei documenti
  non viene mai registrato. I log non lasciano il dispositivo: leggili prima di
  allegarli a una segnalazione.

## Segnalazioni

Non pubblicare vulnerabilità come issue. Usa **Security → Report a
vulnerability** nel repository GitHub per inviare una
[segnalazione privata](https://github.com/eliagentili/local-ai-desk/security/advisories/new),
includendo versione, piattaforma, impatto e una riproduzione minima. **Non
allegare documenti reali o dati personali**: un file di esempio costruito da zero
è sempre sufficiente.

Tempi dichiarati, best-effort per un progetto mantenuto da una persona:

| Fase | Tempo |
| --- | --- |
| Conferma di ricezione | 3 giorni lavorativi |
| Valutazione iniziale con una prima classificazione dell'impatto | 10 giorni lavorativi |
| Correzione o piano dichiarato per un difetto sfruttabile | 90 giorni dalla conferma |
| Divulgazione coordinata | alla pubblicazione della correzione, o alla scadenza dei 90 giorni |

Se un difetto è già sfruttato attivamente, la divulgazione viene anticipata:
tacere in quel caso protegge solo chi attacca. Il credito nell'avviso viene dato a
chi segnala, salvo richiesta contraria.

Prima di segnalare, controlla i
[rischi accettati](docs/THREAT_MODEL.md#rischi-accettati): sono limiti noti e
consapevoli, e la risposta sarebbe un rimando a quel documento.

Per tutto ciò che non è una vulnerabilità: [SUPPORT.md](SUPPORT.md).
