# Release checklist

## Obbligatorio per ogni beta

- [ ] working tree pulito e versione SemVer coerente;
- [ ] test TypeScript, Rust e Python verdi su macOS e Windows;
- [ ] audit npm, Rust e Python senza vulnerabilità critiche note;
- [ ] installer prodotti da runner nativi;
- [ ] SBOM SPDX e `SHA256SUMS.txt` allegati alla release;
- [ ] note di rilascio con piattaforme, requisiti, privacy e limiti noti;
- [ ] test di installazione, avvio, elaborazione e disinstallazione su macchina pulita;
- [ ] verifica che nessun modello, documento o segreto sia incluso negli artefatti.

## Obbligatorio per la stabile 1.0

- [ ] firma Developer ID e notarizzazione Apple;
- [ ] firma Authenticode Windows;
- [ ] aggiornamenti automatici firmati e rollback verificato;
- [ ] threat model e audit privacy aggiornati;
- [ ] test di spazio disco esaurito, force quit, file ostili e batch multi-GB;
- [ ] accessibilità VoiceOver, tastiera e contrasto verificata;
- [ ] supporto e disclosure privata presidiati.
