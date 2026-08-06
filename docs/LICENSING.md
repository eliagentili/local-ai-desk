# Licenze e distribuzione

## Proposta per il codice

Prima della pubblicazione conviene scegliere esplicitamente tra:

- **AGPL-3.0-or-later**, se l'obiettivo prioritario è mantenere pubbliche anche
  modifiche distribuite o offerte come servizio;
- **Apache-2.0**, se l'obiettivo prioritario è massimizzare riuso e contributi,
  mantenendo una chiara concessione sui brevetti;
- una strategia duale, solo se esiste una reale esigenza commerciale futura.

Nessun file `LICENSE` viene aggiunto nella Foundation finché questa decisione
non è approvata.

## Motori e modelli

“Open source” del codice non implica automaticamente che ogni modello sia
ridistribuibile. Prima di includere un pack devono essere registrati:

- repository e revisione esatta;
- licenza del codice;
- licenza dei pesi;
- dataset dichiarati e limitazioni d'uso;
- dimensione, checksum e URL ufficiale;
- obblighi di attribuzione e notice;
- compatibilità con distribuzione gratuita e uso commerciale.

Il repository pubblico non dovrebbe contenere pesi. L'app scaricherà solo pack
selezionati dall'utente da origini dichiarate e verificate.

## Release pubblica

Ogni release dovrà includere inventario dipendenze, `THIRD_PARTY_NOTICES`, SBOM,
checksum, firma/notarizzazione e una pagina privacy che distingua nettamente
funzioni locali da eventuali integrazioni esterne opt-in.
