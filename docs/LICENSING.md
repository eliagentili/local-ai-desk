# Licenze e distribuzione

## Licenza del codice

Il progetto è pubblicato con licenza **AGPL-3.0-or-later**. È la scelta più
coerente con l'obiettivo di mantenere libero il cruscotto e con i motori AGPL
integrati nel flusso locale, in particolare PDFMathTranslate-next e PyMuPDF.

La licenza copre il codice originale del repository. Non cambia le licenze dei
componenti separati scaricati dall'utente.

L'app distribuita veicola la propria licenza: `LICENSE` e
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) stanno fra le risorse del
bundle, il manifest dichiara `license`, `licenseFile`, `copyright`, `publisher` e
`homepage`, e **Impostazioni → Licenza e sorgente** mostra versione, licenza,
apre il file di licenza incluso e il repository al tag della build. È la
condizione con cui l'object code può essere distribuito: il fatto che il
repository sia pubblico non basta, se nulla nel prodotto lo indica.

## Motori e modelli

«Open source» del codice non implica automaticamente che ogni modello sia
ridistribuibile. Prima di includere un pack devono essere registrati:

- repository e revisione esatta;
- licenza del codice;
- licenza dei pesi;
- dataset dichiarati e limitazioni d'uso;
- dimensione, checksum e URL ufficiale;
- obblighi di attribuzione e notice;
- compatibilità con distribuzione gratuita e uso commerciale.

Stato reale rispetto a questo elenco: repository, dimensione e licenza dei pesi
sono registrati nei notices; **la revisione esatta non lo è per tutti**. Gli
asset di bootstrap (uv, il binario Ollama, il sorgente del Privacy Filter) sono
fissati per SHA-256 e verificati prima dell'uso; i pesi presi da Hugging Face e
dal registro Ollama sono identificati per tag e non per revisione, quindi
`ModelPack` non ha ancora i campi `revision`, `license` e `license_url` che
questa pagina richiede. È un limite dichiarato, non una casella spuntata.

Il repository non contiene pesi. L'app scarica solo i pack scelti dall'utente da
origini dichiarate: il meccanismo esiste dalla 0.6 — download su richiesta con
progresso reale in byte, cartella di staging e pubblicazione atomica a
destinazione, così `engine_status` non dichiara pronto un motore i cui pesi sono
a metà. Del checkpoint Privacy Filter viene scaricata solo la sottocartella che
serve: senza quel filtro sarebbero circa 17 GB invece di 2,6.

Nessun modello mostra i propri termini prima del download. Per TranslateGemma —
derivato da Gemma, quindi soggetto ai Gemma Terms of Use e alla Prohibited Use
Policy — il solo avviso oggi è nei notices e nel README. La conferma esplicita in
app è il lavoro che chiude questo punto.

## Release pubblica

Ogni release include:

- gli installer per macOS e Windows;
- il manifest dell'updater e le firme Ed25519 dei pacchetti;
- `SHA256SUMS.txt` con la propria firma, la chiave pubblica dell'updater e un
  foglio con i comandi di verifica;
- l'SBOM SPDX, che cataloga anche i pacchetti dei lock ma **non** ne dichiara le
  licenze (`NOASSERTION` per la maggior parte);
- [THIRD_PARTY_LICENSES.md](../THIRD_PARTY_LICENSES.md), l'inventario delle
  licenze generato dai lock, dal grafo Cargo e da `package-lock.json`;
- le note di rilascio, che dichiarano i limiti noti.

`LICENSE` e `THIRD_PARTY_NOTICES.md` viaggiano dentro il bundle installato.
L'inventario completo è allegato alla release e non è ancora dentro il bundle.

**La 1.0 esce non firmata**, senza certificato Apple né Authenticode: è una
decisione, non un rinvio, e il motivo è che il progetto è gratuito e senza
entrate. Vedi [ROADMAP.md](ROADMAP.md) e [INSTALL.md](INSTALL.md).

## Dove guardare

- [../THIRD_PARTY_LICENSES.md](../THIRD_PARTY_LICENSES.md) — inventario generato:
  ogni pacchetto Python dei cinque lock, ogni crate non-dev del grafo Cargo, ogni
  dipendenza non-dev di `package-lock.json`, con versione e licenza dichiarata. È
  rigenerato da `scripts/collect-licenses.mjs` e la CI fallisce se il file
  committato è alla deriva.
- [../THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) — riepilogo commentato
  dei componenti principali, dei modelli e delle voci con obblighi non
  permissivi (AGPL, GPL, LGPL, MPL, e le wheel che incorporano FFmpeg).
