# Licenze e distribuzione

## Licenza del codice

Il progetto è pubblicato con licenza **AGPL-3.0-or-later**. È la scelta più
coerente con l'obiettivo di mantenere libero il cruscotto e con i motori AGPL
integrati nel flusso locale, in particolare PDFMathTranslate-next e PyMuPDF.

La licenza copre il codice originale del repository. Non cambia le licenze dei
componenti separati scaricati dall'utente.

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

Ogni release include `THIRD_PARTY_NOTICES`, SBOM, checksum e una pagina privacy.
La prima beta è intenzionalmente indicata come non firmata. Firma/notarizzazione
Apple e Authenticode Windows restano obbligatorie prima della stabile 1.0.

La matrice verificata si trova in [../THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).
