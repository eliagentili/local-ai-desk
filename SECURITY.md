# Sicurezza

## Stato

Local AI Desk 2 è in fase Foundation e non è ancora una release pubblica.

## Proprietà già applicate

- il frontend non dispone di accesso generico alla shell;
- il solo permesso aggiuntivo è il selettore nativo di apertura file;
- la Content Security Policy impedisce connessioni web dal frontend;
- il ponte temporaneo verso la v1 usa un indirizzo loopback fisso e un timeout;
- backend e Ollama vengono avviati senza console e accettano solo loopback;
- le risorse installate restano separate da venv, cache e modelli per utente;
- i path importati vengono canonicalizzati e devono riferirsi a file reali;
- i file grandi vengono letti a blocchi, non caricati interamente in memoria;
- il database abilita foreign key, WAL e timeout in caso di concorrenza.

## Prima di accettare file non fidati

La versione pubblica dovrà isolare parser e motori in processi worker con limiti
di CPU, memoria e tempo; verificare archivi compressi e decompression bomb;
neutralizzare contenuti attivi nei documenti; redigere i log; e non aprire
automaticamente output potenzialmente eseguibili.

## Segnalazioni

Finché non esiste un canale privato dedicato, non pubblicare vulnerabilità come
issue. Il metodo di contatto verrà aggiunto prima della prima release esterna.
