# Privacy

Ultimo aggiornamento: 6 agosto 2026.

Local AI Desk è progettato per elaborare i file sul dispositivo. L'app non
include telemetria, pubblicità, account, analytics o crash reporting remoto e
non invia i documenti dell'utente ai gestori del progetto.

## Connessioni di rete

L'applicazione desktop non richiede un servizio cloud per elaborare i file. La
rete viene usata durante l'installazione opzionale dei motori per scaricare
software e modelli dalle rispettive origini, tra cui GitHub, PyPI, Astral,
Ollama e Hugging Face. Questi fornitori ricevono i normali metadati di una
richiesta HTTP, come indirizzo IP, user agent e data; non ricevono i documenti
elaborati dall'app.

I termini e le informative dei fornitori dei download restano applicabili. Le
origini e le licenze sono elencate in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Dati conservati

Il database locale conserva percorsi, metadati, hash, stato dei lavori e
impostazioni. I file originali non vengono copiati nel database. Risultati,
modelli, cache e log rimangono nel profilo locale dell'utente. I log non devono
contenere il contenuto dei documenti; nomi e percorsi possono comparire nei log
diagnostici locali.

I file aperti con **Drop rapido** non vengono inseriti nella Libreria e non sono
inclusi nel database. Le copie temporanee usate per trasferirli ai motori locali
vengono eliminate dopo il completamento, l'errore o l'annullamento. L'output
resta invece disponibile finché l'utente non lo elimina.

## Controllo e cancellazione

La posizione effettiva dei dati viene mostrata in **Impostazioni**. Disinstallare
l'app non elimina automaticamente modelli e risultati: questa scelta evita
perdite involontarie. L'utente può cancellare manualmente la cartella dati dopo
aver chiuso l'app e conservato gli output desiderati.

## Funzioni future

Qualunque futura integrazione online dovrà essere disattivata per impostazione
predefinita, chiaramente riconoscibile e documentata prima dell'invio. Un
aggiornamento di questa policy accompagnerà ogni cambiamento materiale.
