# Sicurezza

## Stato

Local AI Desk 2 è distribuito come beta pubblica. Non è ancora raccomandato per
documenti ostili o flussi regolamentati senza un'ulteriore valutazione del rischio.

## Proprietà già applicate

- il frontend non dispone di accesso generico alla shell;
- il solo permesso aggiuntivo è il selettore nativo di apertura file;
- la Content Security Policy impedisce connessioni web dal frontend;
- il ponte verso i motori usa un indirizzo loopback fisso e timeout espliciti;
- backend e Ollama vengono avviati senza console e accettano solo loopback;
- le risorse installate restano separate da venv, cache e modelli per utente;
- i path importati vengono canonicalizzati e devono riferirsi a file reali;
- i file grandi vengono letti a blocchi, non caricati interamente in memoria;
- il database abilita foreign key, WAL e timeout in caso di concorrenza.

## Limiti noti della beta

Parser e motori non sono ancora isolati in sandbox con limiti rigidi di CPU,
memoria e tempo. La protezione contro archivi ricorsivi, decompression bomb e
contenuti attivi richiede ulteriore hardening. Non elaborare file provenienti da
fonti non fidate e non aprire output eseguibili senza verificarli.

## Segnalazioni

Non pubblicare vulnerabilità come issue. Usa **Security → Report a
vulnerability** nel repository GitHub per inviare una segnalazione privata,
includendo versione, piattaforma, impatto e una riproduzione minima. Non allegare
documenti reali o dati personali. Riceverai una conferma iniziale appena un
maintainer avrà esaminato la segnalazione.
