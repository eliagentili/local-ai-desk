# Release checklist

I passaggi operativi (dove allineare la versione, come si taggano, cosa fare se
il job fallisce dopo il tag, rollback e custodia della chiave) sono in
[RELEASING.md](RELEASING.md). Qui ci sono solo le caselle da spuntare, e ognuna
va spuntata con un'evidenza allegata alla release — non per fiducia.

## Obbligatorio per ogni release

- [ ] working tree pulito e versione SemVer coerente nei cinque punti
      (`package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`,
      `src-tauri/Cargo.toml` con `Cargo.lock`, `bundle.windows.wix.version` a
      quattro numeri);
- [ ] controllo dei tipi TypeScript, test del frontend, test Rust e Python verdi
      su macOS e Windows;
- [ ] `npm run lint` verde: nessun colore letterale fuori da `:root` e dal blocco
      dark, nessun testo informativo sotto 11px;
- [ ] `npm run test:contrast` verde nei due temi: testo ≥ 4.5:1, bordi e
      riempimenti di controllo ≥ 3:1, e ogni token di colore coperto da almeno
      una misura;
- [ ] `npm run test:licenses` verde: `THIRD_PARTY_LICENSES.md` rigenerato dai lock
      e non alla deriva;
- [ ] audit npm, Rust e Python senza vulnerabilità critiche note;
- [ ] installer prodotti da runner nativi;
- [ ] smoke test degli artefatti in CI: un solo `.app`/`.dmg`, installazione
      silenziosa NSIS, binario che si avvia e resta vivo;
- [ ] artefatti updater, firme Ed25519 e manifest validi per macOS e Windows,
      verificati con minisign contro la chiave pubblica estratta dal binario;
- [ ] SBOM SPDX, `SHA256SUMS.txt` con la sua firma, chiave pubblica
      dell'updater, foglio di verifica e `THIRD_PARTY_LICENSES.md` allegati alla
      release;
- [ ] `LICENSE` e `THIRD_PARTY_NOTICES.md` presenti dentro il bundle scaricato,
      non solo nel repository, e raggiungibili da **Impostazioni → Licenza e
      sorgente**;
- [ ] note di rilascio in `.github/release-notes/v<versione>.md` con piattaforme,
      requisiti, privacy, come autorizzare un'app non firmata e limiti noti;
- [ ] test di installazione, avvio, elaborazione e disinstallazione su macchina
      pulita, per entrambe le piattaforme;
- [ ] verifica che nessun modello, documento o segreto sia incluso negli
      artefatti;
- [ ] screenshot rigenerati se l'interfaccia è cambiata dalla release precedente,
      o l'assenza dichiarata nel README.

## Obbligatorio per una stabile

- [ ] nessun percorso può produrre un lavoro `completed` con output assente,
      vuoto o di soli spazi (test Rust e Python);
- [ ] annullamento verificato per **ogni** motore: eccezione sollevata, nessun
      processo figlio residuo, semaforo rilasciato;
- [ ] input ostili coperti da test: archivio a espansione elevata, archivio
      nidificato, PDF troncato, PDF protetto da password, estensione che mente
      sul contenuto;
- [ ] recovery dei lavori attivi al riavvio verificato da un test
      (`running` → `interrupted`);
- [ ] il database rifiuta un archivio scritto da uno schema più recente, con
      messaggio azionabile;
- [ ] [THREAT_MODEL.md](THREAT_MODEL.md) e [PRIVACY_AUDIT.md](PRIVACY_AUDIT.md)
      aggiornati alla release, con i rischi accettati ancora veri;
- [ ] [ACCESSIBILITY.md](ACCESSIBILITY.md) aggiornato: cosa è verificato e cosa
      no, senza caselle spuntate per fiducia;
- [ ] canali di supporto e disclosure privata presidiati, con i tempi dichiarati
      in [SUPPORT.md](../SUPPORT.md) ancora sostenibili;
- [ ] i limiti noti del README e delle note di rilascio corrispondono a ciò che la
      build fa davvero, voce per voce.

## Fuori dalla checklist, in modo permanente

Non sono caselle rimandate: sono decisioni. Vanno **dichiarate** in ogni release,
non riaperte a ogni ciclo.

- **Firma Developer ID e notarizzazione Apple; firma Authenticode Windows.**
  Local AI Desk è gratuito e senza entrate: i due programmi costano insieme
  centinaia di euro all'anno fra abbonamenti e certificati su hardware conforme.
  La conseguenza per l'utente è spiegata in [INSTALL.md](INSTALL.md) e ripetuta
  nei limiti noti. Per lo stesso motivo la CI non esegue `spctl`, `stapler
  validate` o `signtool verify`: su un bundle ad-hoc sarebbero cancelli che
  possono solo essere rossi.
- **Canali Homebrew cask e winget.** Entrambi presuppongono in pratica un'app
  firmata.
- **Attestazione di build provenance.** Non è pubblicata; la garanzia offerta è
  il checksum firmato più la firma Ed25519 degli aggiornamenti.

## Non ancora eseguito, e dichiarato tale

Queste voci non bloccano la 1.0 perché sono dichiarate nei limiti noti, ma non
sono spuntabili oggi. Sono il primo lavoro dopo la release.

- [ ] rollback dell'aggiornamento eseguito su macchine pulite per entrambe le
      piattaforme, seguendo la procedura di [RELEASING.md](RELEASING.md);
- [ ] i tre flussi principali percorsi con VoiceOver su macOS e NVDA o Narrator su
      Windows, registrati in [ACCESSIBILITY.md](ACCESSIBILITY.md);
- [ ] collaudo su volume pieno reale, `kill -9` a metà lavoro, video oltre 4 GB,
      PDF scansionato da ~2000 pagine e batch misto da 500 file, con RAM di picco
      e tempi registrati;
- [ ] crash-free rate e tempo di avvio misurati su un campione di avvii per
      piattaforma, dal log applicativo.
