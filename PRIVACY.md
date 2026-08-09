# Privacy

Ultimo aggiornamento: 9 agosto 2026.

Local AI Desk elabora i file sul dispositivo. L'app non include telemetria,
pubblicità, account, analytics né crash reporting remoto, e non invia i documenti
dell'utente ai gestori del progetto.

Questa è l'informativa. L'inventario verificabile — ogni flusso di rete con la
riga di codice che lo origina, ogni file scritto sul disco con chi lo scrive e
quando viene cancellato, e i comandi ripetibili con cui l'assenza di telemetria è
stata controllata — è in [docs/PRIVACY_AUDIT.md](docs/PRIVACY_AUDIT.md).

## Connessioni di rete

L'applicazione non richiede un servizio cloud per elaborare i file. Le uniche
connessioni che origina sono quattro tipi, e nessuna trasporta i documenti
dell'utente:

1. **Controllo degli aggiornamenti** (vedi il paragrafo seguente).
2. **Installazione dei motori**, una sola volta e su richiesta esplicita: scarica
   software e modelli dalle rispettive origini, tra cui GitHub, PyPI, Astral,
   Ollama e Hugging Face.
3. **Download di un singolo pacchetto di modello** dalla sezione **Modelli**, solo
   quando l'utente lo chiede.
4. **Primo utilizzo dell'OCR**: il motore OCR scarica da sé i propri modelli alla
   prima elaborazione, quindi il primo OCR richiede una connessione. Viene
   scaricato un modello; il documento non viene inviato.

I fornitori dei download ricevono i normali metadati di una richiesta HTTP, come
indirizzo IP, user agent e data. Non ricevono i documenti elaborati dall'app. I
loro termini e le loro informative restano applicabili; origini e licenze sono
elencate in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Traduzione, OCR e trascrizione avvengono contattando processi locali sull'indirizzo
`127.0.0.1`, che non lascia il dispositivo. L'ambiente di traduzione installa,
come dipendenze indirette, adapter per servizi di traduzione online: **non sono
configurati né selezionabili** e l'indirizzo di destinazione è fissato al
loopback. Restano nell'ambiente come codice inutilizzato e sono dichiarati nei
notices.

## Controllo automatico degli aggiornamenti

L'app contatta GitHub circa 15 secondi dopo l'avvio e poi ogni 6 ore per leggere
il manifest della release più recente. È una richiesta HTTPS verso
`github.com`: GitHub riceve i metadati di rete della richiesta, e l'app **non**
invia un identificatore di installazione, la versione installata, il sistema
operativo né alcun dato d'uso.

- Il controllo si **disattiva** con un interruttore in **Impostazioni**. Da
  disattivato, nessuna richiesta parte.
- Il download del pacchetto avviene solo dopo conferma dell'utente. Se un lavoro è
  in corso, l'installazione resta in attesa.
- Il pacchetto viene accettato solo se supera la verifica della firma Ed25519.
- La preferenza è conservata localmente nella cartella dati dell'app.

## Dati conservati

Il database locale conserva percorsi, nomi, dimensioni, hash del contenuto, stato
e cronologia dei lavori, messaggi d'errore e impostazioni. **I file originali non
vengono copiati nel database.** Risultati, modelli, cache e log rimangono nel
profilo locale dell'utente.

I log restano sul dispositivo e ruotano quando crescono troppo. Non contengono il
contenuto dei documenti; **nomi e percorsi dei file possono comparirvi**, quindi
un log allegato a una segnalazione pubblica va prima letto e ridotto alle righe
utili (vedi [SUPPORT.md](SUPPORT.md)).

I file aperti con **Drop rapido** non vengono inseriti nella Libreria e non sono
inclusi nel database. Le copie temporanee usate per trasferire un file ai motori
locali vengono eliminate al completamento, all'errore e all'annullamento; quelle
che un arresto anomalo lascia indietro vengono rimosse al successivo avvio.
L'output resta invece disponibile finché l'utente non lo elimina.

## Controllo e cancellazione

La posizione effettiva dei dati è mostrata in **Impostazioni**. Disinstallare
l'app **non** elimina modelli e risultati: sono decine di gigabyte e contengono
gli output dell'utente, quindi la scelta di cancellarli resta sua. L'utente può
rimuovere manualmente la cartella dati dopo aver chiuso l'app e conservato ciò che
gli serve; l'elenco di ciò che resta sul disco, con i percorsi esatti per macOS e
Windows, è in [docs/INSTALL.md](docs/INSTALL.md#7-disinstallare).

## Se questa informativa cambia

Qualunque integrazione online futura sarà disattivata per impostazione
predefinita, chiaramente riconoscibile nell'interfaccia e documentata qui prima
del primo invio. Ogni cambiamento materiale è accompagnato da un aggiornamento di
questa pagina, con la data in cima.
