# Visione di prodotto

## Promessa

Local AI Desk deve rendere elaborazioni AI normalmente frammentate — OCR,
conversione, traduzione, trascrizione, privacy, ricerca e automazione —
comprensibili e affidabili in un unico workspace che lavora sul computer
dell'utente.

La promessa non è “avere molti tool”. È ottenere un risultato verificabile
senza dover conoscere modelli, dipendenze o terminale.

## Principi

1. **Locale per impostazione predefinita.** Nessun file lascia il dispositivo
   senza un'azione esplicita, specifica e comprensibile.
2. **Risultati, non motori.** L'utente sceglie “traduci” o “trascrivi”; il router
   seleziona il percorso adatto e mostra la sua decisione.
3. **Stato sempre visibile.** Ogni lavoro espone fase, avanzamento, tempo,
   risorse, possibilità di annullamento e risultato parziale quando disponibile.
4. **Nessuna falsa completezza.** Una funzione non pronta è dichiarata tale;
   esempi e demo non fingono di essere output reali.
5. **Progressive disclosure.** Il percorso Auto è immediato, ma modalità,
   modelli e parametri avanzati restano accessibili.
6. **Ripartenza sicura.** Coda e risultati sopravvivono a chiusure, errori e
   riavvii.
7. **Accessibilità dal primo giorno.** Tastiera, VoiceOver, contrasto,
   movimento ridotto e tema di sistema non sono una rifinitura finale: il
   contrasto dei token è misurato da un test che blocca la CI. Anche qui vale la
   regola di non dichiarare più di quel che è vero: nessun flusso è stato
   percorso con uno screen reader reale, e lo stato è scritto in
   [ACCESSIBILITY.md](ACCESSIBILITY.md).
   L'internazionalizzazione è dichiarata per quello che è: l'interfaccia
   è oggi solo in italiano e le localizzazioni complete sono in
   [roadmap](ROADMAP.md) F5.

## Superfici previste (stato d'arrivo)

Questo è lo stato d'arrivo, non l'interfaccia della 1.0. La colonna «Nella 1.0»
dice cosa esiste oggi: una superficie che non c'è non compare nella barra
laterale, perché una voce di primo livello che apre una pagina segnaposto promette
qualcosa che non esiste.

| Superficie | Stato d'arrivo | Nella 1.0 |
| --- | --- | --- |
| **Home** | azioni rapide, attività, risorse e risultati recenti | presente. Al primo avvio, finché i motori non sono installati, cede il posto a una schermata di benvenuto che spiega cosa fa l'app, quanto spazio serve e quanto ne resta |
| **Libreria** | fonti e risultati con ricerca, tag, collezioni e versioni | presente in forma ridotta: elenca e filtra le fonti per nome e tipo. Tag, collezioni, versioni e collegamento fonte→risultato sono in [roadmap](ROADMAP.md) F3 |
| **Studio** | lavoro guidato su un elemento, con input, anteprima e output | presente senza anteprima: input, obiettivo, formato e opzioni. L'anteprima e il confronto prima/dopo sono in F2 |
| **Attività** | coda globale, progresso, annullamento, retry e log leggibili | presente e completa: dalla 1.0 ogni lavoro espone anche la cronologia dei suoi eventi, con fase, stato, messaggio e copia negli appunti |
| **Modelli** | pack installabili, dimensioni, compatibilità e aggiornamenti | presente: installazione dei motori con fase e annullamento, spazio richiesto e libero, download su richiesta del pack Privacy Filter. Rimozione, riparazione e aggiornamento di un singolo pack mancano |
| **Impostazioni** | privacy, rete, storage, risorse, diagnostica e aggiornamenti | presente come diagnostica, aggiornamenti, log, licenza e sorgente. L'unica preferenza è il controllo automatico degli aggiornamenti: concorrenza, retention e tema non hanno un interruttore (F5). Non ci sono notifiche di sistema: a batch concluso l'esito si legge in Attività |
| **Workflow** | pipeline salvabili, cartelle sorvegliate e automazioni locali | **assente**. La voce è stata rimossa dalla barra laterale nella 1.0: era una pagina segnaposto. La promessa vive in F4 |

Home e Studio espongono inoltre una corsia **Drop rapido**, distinta dalla
Libreria: serve per elaborare e dimenticare una sorgente senza indicizzarla. La
conservazione è una scelta esplicita, non un effetto collaterale dell'uso.

## Definizione di “Apple-grade”

Non significa imitare l'aspetto di macOS. Significa ridurre le decisioni non
necessarie, usare comportamenti nativi, mantenere latenza percepita bassa,
offrire messaggi azionabili, rispettare tastiera e accessibilità e rendere
semplice tornare indietro da ogni operazione.
