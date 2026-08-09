# Pubblicare una release

Procedura operativa. Vale per una stabile e per una beta: cambia solo il suffisso
del tag. La checklist di qualità da spuntare **prima** di arrivare qui è in
[RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md).

Il pipeline pubblica installer non firmati dal sistema operativo: è una decisione
di prodotto, documentata in [INSTALL.md](INSTALL.md#6-perché-non-è-firmata) e fra
i rischi accettati del [modello di minaccia](THREAT_MODEL.md#r7--nessuna-firma-del-codice-e-nessuna-attestazione-di-provenienza).
Non aggiungere passi di codesign, notarizzazione o `signtool` a questi workflow
senza aggiornare quei due documenti.

---

## 1. Allineare la versione

Il tag e la versione compilata devono coincidere, altrimenti ogni installazione
esistente vede per sempre un aggiornamento che installa la stessa build. Il
controllo in CI blocca la pubblicazione se non coincidono, ma copre solo tre dei
cinque punti: gli altri due vanno controllati a mano.

| Punto | File | Formato | Presidiato dalla CI |
| --- | --- | --- | --- |
| 1 | `package.json` → `version` | SemVer, es. `1.0.0` | Sì |
| 2 | `src-tauri/tauri.conf.json` → `version` (chiave di primo livello) | SemVer | Sì |
| 3 | `src-tauri/Cargo.toml` → `version` in `[package]` | SemVer | Sì |
| 4 | `package-lock.json` → `version`, **due volte**: alla radice e in `packages[""]` | SemVer | **No** |
| 5 | `src-tauri/tauri.conf.json` → `bundle.windows.wix.version` | **Quattro numeri**, es. `1.0.0.0` | **No** |

Il modo corretto di aggiornare il punto 4 è `npm install` dopo aver cambiato
`package.json`: il lock si allinea da solo e non va modificato a mano. Se resta
indietro, l'SBOM allegato alla release identifica l'applicazione con la versione
sbagliata.

Il punto 5 non accetta un SemVer: Windows Installer vuole quattro numeri interi e
non capisce il suffisso di prerelease. Regola: `1.0.0` → `1.0.0.0`,
`1.0.0-beta.1` → `1.0.0.1`, `1.0.0-beta.2` → `1.0.0.2`. Se `wix.version` resta
indietro, l'MSI esce con una `ProductVersion` vecchia, Windows Installer rifiuta
l'aggiornamento in place e **la CI resta verde**.

Verifica prima di andare avanti:

```bash
grep -n '"version"' package.json package-lock.json src-tauri/tauri.conf.json
grep -n '^version' src-tauri/Cargo.toml
grep -n -A 2 '"wix"' src-tauri/tauri.conf.json
```

## 2. Scrivere le note di rilascio

Crea `.github/release-notes/v<versione>.md` — il nome del file deve corrispondere
esattamente al tag, suffisso compreso.

Diventano sia il corpo della GitHub Release sia il campo `notes` del manifest
dell'updater, quindi sono ciò che l'utente legge nel pannello di aggiornamento
dentro l'app. Scrivile per quella finestra: brevi, senza gergo interno.

Contenuto minimo:

- cosa cambia per chi usa l'app, in ordine di importanza;
- **i limiti noti**, con le stesse frasi del README: non abbellirli, non ometterli;
- l'attrito di installazione con il rimando a [INSTALL.md](INSTALL.md), perché chi
  arriva alla pagina di release per la prima volta è la persona che rinuncia;
- i comandi con cui verificare il download.

Se il file manca, `scripts/prepare-release-assets.mjs` non fallisce: mette
`"Aggiornamento di Local AI Desk 2."` nel manifest e il job di pubblicazione usa
le note generate da GitHub. È un fallback silenzioso — nessuno se ne accorge
prima che l'utente lo legga. Controlla che il file esista.

## 3. Controlli locali

```bash
npm run check
npm run build
npm run test:release
cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
cd .. && PYTHONPATH=engine python -m unittest discover -s engine/tests -v
```

Committa tutto. L'albero di lavoro deve essere pulito: il tag deve puntare a ciò
che verrà compilato.

## 4. Taggare e pubblicare

```bash
git tag v1.0.0
git push origin main
git push origin v1.0.0
```

Il push del tag avvia il workflow `Desktop CI and release`. In ordine:

1. **Test dei motori** su macOS e Windows.
2. **Build** su entrambe le piattaforme, con verifica preventiva della presenza
   dei secret di firma dell'updater.
3. **SBOM** SPDX del sorgente.
4. **Pubblicazione**: coerenza fra tag e versioni, preparazione degli asset con
   nomi deterministici e `SHA256SUMS.txt`, verifica di ogni firma `.sig` con
   `minisign` contro la chiave pubblica estratta dal binario, `gh release create`.

Il passo di verifica delle firme esiste perché una chiave ruotata pubblicherebbe
altrimenti una release che nessun client può installare: l'app si fida solo della
chiave pubblica compilata dentro di sé.

Asset pubblicati: DMG, archivio `.app.tar.gz` per l'updater, installer NSIS, MSI,
le firme `.sig`, `latest.json`, l'SBOM e `SHA256SUMS.txt`.

## 5. Dopo la pubblicazione

- Scarica il DMG e l'installer EXE dalla release e confrontali con
  `SHA256SUMS.txt`: verifica che il file pubblicato sia quello che la CI ha
  misurato.
- Apri `latest.json` e controlla che `version` sia il tag senza `v` e che i due
  URL puntino agli asset di questa release.
- Su una macchina con la versione precedente installata, attendi il controllo
  automatico e verifica che l'aggiornamento venga proposto, scaricato e
  installato.
- Se la release è una beta, marcala come prerelease **subito**: il workflow passa
  `--latest`, quindi finché non la marchi resta l'aggiornamento offerto a tutti.

---

## Se il job fallisce dopo che il tag è pubblico

`gh release create` **non è idempotente**: rilanciarlo su un tag che ha già una
release fallisce. Il punto in cui il job si ferma decide cosa fare.

### Caso 1 — fallimento prima del passo «Publish release»

Nessuna release esiste. Correggi la causa su `main`, poi sposta il tag:

```bash
git tag -d v1.0.0
git push origin :refs/tags/v1.0.0
git tag v1.0.0
git push origin v1.0.0
```

Cancellare e ricreare un tag è accettabile **solo** finché nessuna release è
stata pubblicata su quel tag: nessun client lo ha ancora visto.

### Caso 2 — fallimento dentro «Publish release», release creata a metà

Verifica cosa esiste:

```bash
gh release view v1.0.0 --json isDraft,isPrerelease,assets
```

Se manca un asset, aggiungilo senza ricreare la release:

```bash
gh release upload v1.0.0 release-assets/<file>
```

Se la release è inservibile, eliminala e ripubblica lo stesso tag:

```bash
gh release delete v1.0.0 --yes
git push origin v1.0.0 --force   # riavvia il workflow sullo stesso commit
```

**Non cancellare il tag** in questo caso se la release era già visibile: qualcuno
potrebbe averla scaricata, e un tag ricreato su un commit diverso renderebbe
irriproducibile ciò che ha in mano.

### Caso 3 — la release è pubblicata e la build è difettosa

Non si corregge in place: si esegue il rollback qui sotto.

---

## Rollback di una release difettosa

L'obiettivo, in ordine: **fermare la propagazione**, poi rimettere gli utenti già
aggiornati su una versione sana, poi dirlo.

L'endpoint dell'updater è
`https://github.com/eliagentili/local-ai-desk/releases/latest/download/latest.json`
(chiave `plugins.updater.endpoints` in `src-tauri/tauri.conf.json`).
`releases/latest` è calcolato da GitHub: esclude
le prerelease. Marcare come prerelease la release difettosa fa quindi ripuntare
l'endpoint alla stabile precedente, **senza toccare una riga di codice**.

### Passo 1 — Fermare la propagazione (minuti)

```bash
gh release edit v1.0.0 --prerelease --latest=false
gh release edit v0.6.0-beta.1 --latest   # la release precedente torna a essere latest
```

Sostituisci `v0.6.0-beta.1` con la release pubblicata subito prima, che trovi con
`gh release list`. Serve indicarla esplicitamente: il workflow pubblica ogni
release con `--latest` e senza `--prerelease`, quindi anche le beta risultano
release piene e GitHub non ha modo di scegliere da sé la «precedente sana».

Verifica che l'endpoint sia tornato indietro:

```bash
curl -sL https://github.com/eliagentili/local-ai-desk/releases/latest/download/latest.json | head -3
```

Il campo `version` deve essere quello della versione sana. Da questo momento
nessuna nuova installazione riceve la build difettosa.

Non cancellare la release difettosa: chi l'ha già installata ha bisogno che i suoi
asset restino raggiungibili per la diagnosi, e i checksum pubblicati restano
l'unico riferimento per capire cosa ha in mano.

### Passo 2 — Riportare indietro chi si è già aggiornato

Il confronto delle versioni dell'updater è semantico: un client sulla `1.0.0` non
accetta la `0.9.0`, perché è più bassa. Rimetterlo su codice sano richiede quindi
una **revert-release con versione superiore**, non un downgrade.

1. Su `main`, `git revert` dei commit difettosi (oppure `git revert` del merge).
2. Alza la patch: `1.0.1`. Allinea i cinque punti del §1.
3. `.github/release-notes/v1.0.1.md` dice cosa è stato ritirato e perché.
4. Tagga e pubblica come al §4. La `1.0.1` supera la `1.0.0`, quindi raggiunge
   anche chi si era già aggiornato.
5. Rimetti `--latest` sulla `1.0.1`.

Se la 1.0.1 non è pronta in tempi brevi, la 1.0.0 resta prerelease: la
propagazione è ferma, e chi si è già aggiornato può reinstallare a mano la
versione precedente, che resta scaricabile fra le release passate.

### Passo 3 — Sui dati dell'utente

Le migrazioni del database sono solo additive (`ensure_column` in
`src-tauri/src/database.rs`) e lo schema è marcato con
`PRAGMA user_version`: una build che trova un archivio scritto da una versione
**più recente** rifiuta di aprirlo con un messaggio che dice cosa fare, invece di
perdere colonne in silenzio. Quindi:

- **1.0.0 → 1.0.1 (avanti)**: nessun problema.
- **1.0.0 → 0.9.0 reinstallata a mano (indietro)**: funziona finché la versione
  dello schema non è stata alzata. Se lo è stata, la vecchia app rifiuta di aprire
  l'archivio e lo dice. In quel caso il messaggio da dare all'utente è: aggiornare
  di nuovo, non cancellare la cartella dati.

Controlla la costante `SCHEMA_VERSION` in `src-tauri/src/database.rs` prima di
suggerire a qualcuno di tornare indietro.

### Passo 4 — Comunicare

Nello stesso ordine, appena il passo 1 è fatto:

1. **Note della release difettosa**: aggiungi in cima un blocco che dice che è
   stata ritirata, cosa succede a chi l'ha installata e cosa fare.
   ```bash
   gh release edit v1.0.0 --notes-file .github/release-notes/v1.0.0-ritirata.md
   ```
2. **Issue di annuncio** con etichetta `bug`, il numero di versione nel titolo,
   sintomo, chi è coinvolto, cosa fare adesso. È il link da dare a chi chiede.
3. **README**, se il difetto impedisce l'installazione: una riga in cima, rimossa
   quando la correzione è pubblicata.
4. **Note della revert-release**: cosa era rotto, cosa è stato fatto, cosa
   controllare per essere sicuri di avere la versione sana.

Non presentare un ritiro come un aggiornamento ordinario.

### Prova del rollback

La procedura va eseguita **una volta per piattaforma** su una macchina pulita,
prima di dichiararla verificata: installare la versione precedente, aggiornare
alla nuova, marcare la nuova come prerelease, verificare che una nuova
installazione riceva la precedente, reinstallare a mano la precedente, confermare
che libreria e cronologia siano leggibili. L'esito va registrato in
[RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md).

---

## Custodia della chiave di firma

La chiave privata Ed25519 firma i pacchetti di aggiornamento. L'app si fida solo
della chiave pubblica compilata dentro di sé (`plugins.updater.pubkey` in
`src-tauri/tauri.conf.json`), quindi:

- **chi possiede la chiave privata può installare qualunque codice su ogni
  dispositivo che ha l'app**;
- **se la chiave è perduta, nessuna release futura è installabile come
  aggiornamento** dalla base installata esistente, che va migrata con un download
  manuale.

Sono due modi diversi di perdere tutto, e vanno gestiti prima del tag.

### Dove sta

| Copia | Dove | Note |
| --- | --- | --- |
| Operativa | GitHub Actions secret `TAURI_SIGNING_PRIVATE_KEY` + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Usati solo sui tag (`.github/workflows/desktop.yml`, passo «Verify updater signing secrets») |
| Backup | Chiave privata cifrata con la propria password, su due supporti offline conservati in due luoghi fisici distinti | Il file `.key` di Tauri è già cifrato dalla password: il backup è quel file, non la chiave in chiaro |
| Password | Gestore di password del maintainer, con la propria copia di ripristino | **Mai** nello stesso supporto del backup della chiave |
| Chiave pubblica | Nel repository, in chiaro | Non è un segreto: è ciò che permette a chiunque di verificare |

**Responsabile**: il maintainer del progetto, oggi unico
(`eliagentili`). Non esiste una seconda persona con accesso: è un rischio di
continuità dichiarato, non risolto.

**Prima di taggare la 1.0**: verifica che il backup offline esista e sia
leggibile. Un backup che non è stato mai aperto non è un backup.

### Come si ruota

La rotazione è visibile agli utenti, perché la chiave pubblica è compilata nel
binario: chi ha una versione firmata con la chiave vecchia **non** accetterà
pacchetti firmati con quella nuova. Quindi si ruota con una release di
transizione, non di soppiatto.

1. `npm run tauri signer generate -- -w <percorso-fuori-dal-repository>`.
2. Metti la nuova chiave pubblica in `src-tauri/tauri.conf.json`
   (`plugins.updater.pubkey`) e pubblica una release **firmata con la chiave
   nuova**. Il passo di verifica in CI confronta le firme con la chiave pubblica
   presente in quel file, quindi coglie subito un disallineamento.
3. Questa release **non raggiunge** la base installata precedente: le note e il
   README devono dire che serve un download manuale, una volta sola.
4. Sostituisci i due secret su GitHub. Aggiorna il backup offline. Distruggi la
   chiave vecchia solo dopo aver confermato che una release firmata con la nuova
   si installa.

### Se la chiave è compromessa

Assumi compromissione se: un secret è comparso in un log, un dispositivo con il
backup è stato perso, un accesso non riconosciuto è comparso sull'account GitHub,
oppure esiste una release che non hai pubblicato tu.

1. **Revoca l'accesso alla catena**: `gh secret delete TAURI_SIGNING_PRIVATE_KEY`
   e la password. Nessuna release può più essere firmata, incluse quelle di chi ha
   la chiave, se non ha anche accesso al repository.
2. **Verifica l'elenco delle release** e cerca ciò che non hai pubblicato tu:
   ```bash
   gh release list --limit 50
   gh api repos/eliagentili/local-ai-desk/releases --jq '.[] | [.tag_name, .created_at, .author.login] | @tsv'
   ```
   Se ne trovi una, marcala prerelease immediatamente (passo 1 del rollback).
3. **Ruota subito** con la procedura sopra. La release di transizione è
   inevitabile: è il prezzo di una chiave compilata nel binario.
4. **Dillo**: un avviso di sicurezza pubblicato dalla scheda Security del
   repository, con la finestra temporale in cui la chiave era esposta e come
   riconoscere una versione firmata dalla chiave nuova. Un utente che ha
   installato un pacchetto firmato dalla chiave compromessa deve poterlo sapere
   dalla pagina del progetto, non da un cambio silenzioso.
5. Aggiorna [../SECURITY.md](../SECURITY.md) e il
   [modello di minaccia](THREAT_MODEL.md) con ciò che l'incidente ha mostrato.

---

## Documenti collegati

- [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) — cosa deve essere vero prima del tag
- [INSTALL.md](INSTALL.md) — l'esperienza che la release consegna
- [THREAT_MODEL.md](THREAT_MODEL.md) — perché la catena è fatta così
- [../SUPPORT.md](../SUPPORT.md) — dove arrivano le segnalazioni
