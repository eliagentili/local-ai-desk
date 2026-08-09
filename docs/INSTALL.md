# Installare Local AI Desk

Local AI Desk **non è firmata** con un certificato Apple né con un certificato
Authenticode. macOS e Windows lo notano e mettono un avviso fra te e l'app. Il
percorso per aprirla comunque esiste su entrambi i sistemi, richiede meno di un
minuto e va fatto una sola volta. Questa pagina lo descrive per intero.

Se questo non ti va bene, non installarla: è una scelta legittima e il resto del
documento non prova a convincerti.

---

## 1. Scarica

| Sistema | File |
| --- | --- |
| macOS 14 o successivo, Apple Silicon | `Local-AI-Desk-macOS-Apple-Silicon.dmg` |
| Windows 10 o 11, x64 | `Local-AI-Desk-Windows-x64-Setup.exe` |
| Windows 10 o 11, x64 (distribuzioni gestite) | `Local-AI-Desk-Windows-x64.msi` |
| Elenco dei checksum | `SHA256SUMS.txt` |

Tutti i file stanno nella
[release più recente](https://github.com/eliagentili/local-ai-desk/releases/latest).

Non esistono build per Mac Intel né per Windows su ARM. Non esistono canali
`brew install --cask` o `winget install`: entrambi presuppongono in pratica un
binario firmato.

Gli aggiornamenti automatici scaricano l'installer **EXE**. Per un uso normale
scegli quello: l'MSI resta pubblicato per chi distribuisce l'app con strumenti
aziendali.

---

## 2. Verifica il file prima di installarlo

Scarica anche `SHA256SUMS.txt` dalla stessa release e confronta.

**macOS**

```bash
cd ~/Downloads
shasum -a 256 Local-AI-Desk-macOS-Apple-Silicon.dmg
grep Local-AI-Desk-macOS-Apple-Silicon.dmg SHA256SUMS.txt
```

Le due righe devono mostrare lo stesso valore esadecimale.

**Windows (PowerShell)**

```powershell
cd $HOME\Downloads
Get-FileHash .\Local-AI-Desk-Windows-x64-Setup.exe -Algorithm SHA256 | Format-List
Select-String Local-AI-Desk-Windows-x64-Setup.exe .\SHA256SUMS.txt
```

**Cosa dimostra e cosa non dimostra.** `SHA256SUMS.txt` è generato insieme agli
installer e pubblicato nella stessa release
(`scripts/prepare-release-assets.mjs`, blocco che scrive `SHA256SUMS.txt`), e **non è firmato**. Confrontarlo
dimostra che il file che hai sul disco è integro e identico a quello che la
release contiene: non dimostra che la release sia autentica, perché chi potesse
sostituire l'installer potrebbe sostituire anche l'elenco. La firma Ed25519 che
l'app verifica riguarda gli **aggiornamenti** (chiave `plugins.updater.pubkey` in
`src-tauri/tauri.conf.json`; verifica in CI al passo «Verify updater signatures
against the shipped public key» di `.github/workflows/desktop.yml`), non questo primo
download. Non è pubblicata un'attestazione di provenienza della build.

---

## 3. macOS 14 e successivi

### Cosa vedi

Trascina `Local AI Desk 2` dal DMG in **Applicazioni** e aprila. Al primo avvio
macOS mostra una finestra che dice — con parole che cambiano leggermente da una
versione all'altra del sistema — che l'app **non può essere aperta perché Apple
non è in grado di verificare la presenza di software dannoso**. I pulsanti
offerti sono soltanto *Annulla* e *Sposta nel Cestino*. Nessuno dei due apre
l'app: la finestra non ha un pulsante per procedere, e questa è la parte che fa
rinunciare quasi tutti.

### Il percorso che funziona

1. Nella finestra di avviso scegli **Annulla** (non *Sposta nel Cestino*).
2. Apri **Impostazioni di Sistema → Privacy e sicurezza**.
3. Scorri fino alla sezione **Sicurezza**. Compare la riga
   «"Local AI Desk 2" è stata bloccata per proteggere il Mac» con il pulsante
   **Apri comunque**.
4. Premi **Apri comunque** e autenticati con Touch ID o con la password del Mac.
5. macOS richiede una conferma finale: scegli **Apri**.

La riga in Privacy e sicurezza compare solo dopo che hai provato ad aprire
l'app almeno una volta, e scompare dopo qualche minuto. Se non la vedi, prova di
nuovo ad aprire l'app e torna subito alle Impostazioni.

Su macOS 14 funziona anche la scorciatoia: clic destro sull'app in Applicazioni
→ **Apri** → **Apri**. Da macOS 15 Apple ha rimosso questa scorciatoia per le
app non notarizzate, quindi resta solo il percorso da Impostazioni di Sistema
descritto sopra. Il percorso da Impostazioni funziona su tutte le versioni: usa
quello e non sbagli.

### Perché continua a chiedertelo

L'app è firmata **ad hoc**: `bundle.macOS.signingIdentity` vale `"-"` in
`src-tauri/tauri.macos.conf.json`. Una firma ad hoc non contiene un'identità di
sviluppatore: garantisce solo che il pacchetto non sia stato modificato dopo la
compilazione, e **cambia a ogni build**. Le conseguenze pratiche:

- macOS non ha modo di collegare questa versione alla precedente, quindi può
  trattare un aggiornamento come un'app nuova e ripetere il blocco;
- le autorizzazioni che avevi già concesso — per esempio l'accesso a Scrivania,
  Documenti o a un disco esterno — sono legate alla firma, quindi il sistema può
  richiedertele di nuovo dopo un aggiornamento;
- se scarichi a mano un DMG più recente invece di usare l'aggiornamento
  automatico, il blocco di Gatekeeper si ripresenta e il percorso è lo stesso.

Se dopo un aggiornamento l'app non parte, non è rotta: rifai i cinque passaggi
del paragrafo precedente.

### Requisiti

macOS **14.0** o successivo (`bundle.macOS.minimumSystemVersion` in
`src-tauri/tauri.macos.conf.json`), Mac con chip Apple Silicon.

---

## 4. Windows 10 e 11

### Il browser, prima di tutto

Il file è poco diffuso e non firmato, quindi il browser può rimuoverlo da solo
prima che tu lo veda.

- **Microsoft Edge**: la barra dei download mostra «Questo file non viene
  scaricato comunemente». Apri il menù `···` accanto al file → **Mantieni** →
  **Mostra ulteriori informazioni** → **Mantieni comunque**.
- **Google Chrome**: nella barra dei download compare un avviso analogo. Espandi
  il download e scegli **Conserva**.
- **Firefox**: nel pannello dei download, clic destro sul file → **Consenti il
  download**.

Se il file è scomparso dalla cartella Download, non hai sbagliato nulla: è stato
il browser. Riprova con i passaggi qui sopra.

Alcune policy aziendali (SmartScreen for Business, AppLocker, Windows Defender
Application Control) bloccano l'esecuzione di eseguibili non firmati e **non
espongono alcuna opzione all'utente**. In quel caso serve il tuo reparto IT: non
c'è un percorso lato utente.

### Cosa vedi all'avvio dell'installer

Fai doppio clic su `Local-AI-Desk-Windows-x64-Setup.exe`. SmartScreen mostra una
finestra blu con il titolo **«Windows ha protetto il PC»** e un solo pulsante
visibile, *Non eseguire*.

1. Scegli **Ulteriori informazioni** (il collegamento sotto il testo).
2. Compaiono l'editore dichiarato come *Sconosciuto* e un nuovo pulsante
   **Esegui comunque**.
3. Premi **Esegui comunque**.

L'installer procede senza altri avvisi e installa per l'utente corrente
(`bundle.windows.nsis.installMode` in `src-tauri/tauri.windows.conf.json`), quindi
non chiede privilegi di amministratore.

### Se Windows dice che il file è bloccato

Windows marca i file scaricati da Internet. Se l'installer si chiude subito o
segnala che l'editore non è verificabile, rimuovi il marcatore:

- clic destro sul file → **Proprietà** → in basso spunta **Annulla blocco** →
  **OK**;
- oppure, in PowerShell:

```powershell
Unblock-File -Path $HOME\Downloads\Local-AI-Desk-Windows-x64-Setup.exe
```

### Requisiti

Windows 10 o 11 a 64 bit. WebView2 è incluso nell'installer e viene installato
in silenzio se manca (`bundle.windows.webviewInstallMode` in
`src-tauri/tauri.windows.conf.json`).

---

## 5. Dopo l'installazione: i motori

L'installer contiene soltanto l'app. I motori che fanno il lavoro — conversione,
OCR, trascrizione, traduzione, mascheramento — si installano **una sola volta**
dall'app, in **Modelli → Installa motori**. Servono Internet e decine di GB di
spazio libero: l'app misura lo spazio disponibile e mostra il requisito prima di
cominciare, e rifiuta di partire se non basta.

I componenti arrivano dalle origini ufficiali (GitHub, PyPI, Astral, il registro
Ollama, Hugging Face) con checksum verificati dove il progetto li fissa. Le
origini e le licenze sono in [../THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md);
i flussi di rete, uno per uno, in [PRIVACY_AUDIT.md](PRIVACY_AUDIT.md).

I modelli Ollama vengono conservati in `~/.ollama/models`, dove Ollama stesso li
tiene: se li hai già, non vengono riscaricati.

---

## 6. Perché non è firmata

Firmare costa: l'Apple Developer Program è un abbonamento annuale, e un
certificato Authenticode utilizzabile oggi richiede una chiave su HSM, quindi un
altro abbonamento. Local AI Desk è gratuita e open source, mantenuta da una
persona, e quelle spese non sono sostenute.

Non c'è una data in cui questo cambierà. Se cambierà, sarà scritto nelle note di
rilascio.

Cosa resta verificabile senza firma del sistema operativo:

- il codice sorgente completo, con la storia dei commit
  ([repository](https://github.com/eliagentili/local-ai-desk));
- lo SHA-256 di ogni file pubblicato (`SHA256SUMS.txt`);
- l'SBOM SPDX allegato a ogni release;
- la firma Ed25519 sugli aggiornamenti, che l'app verifica e senza la quale
  rifiuta il pacchetto.

Cosa **non** hai: la garanzia che dà Apple o Microsoft quando controllano
l'identità di chi pubblica. Il modello di minaccia, compreso ciò che comporta
l'assenza di firma, è in [THREAT_MODEL.md](THREAT_MODEL.md).

---

## 7. Disinstallare

**macOS** — chiudi l'app, poi sposta nel Cestino:

- `/Applications/Local AI Desk 2.app`
- `~/Library/Application Support/it.local.localaidesk2` (database, risultati,
  log, ambiente dei motori)
- `~/.ollama/models`, **soltanto** se non usi Ollama per altro

**Windows** — *Impostazioni → App → App installate → Local AI Desk 2 →
Disinstalla*, poi elimina:

- `%APPDATA%\it.local.localaidesk2`
- `%USERPROFILE%\.ollama\models`, **soltanto** se non usi Ollama per altro

La disinstallazione non rimuove da sola dati e modelli: sono decine di GB e
contengono i tuoi risultati, quindi la scelta di cancellarli resta tua.
L'inventario completo di ciò che resta sul disco è in
[PRIVACY_AUDIT.md](PRIVACY_AUDIT.md).

---

## 8. Se qualcosa non torna

[SUPPORT.md](../SUPPORT.md) elenca i canali, cosa allegare a una segnalazione e
cosa non allegare mai.
