# Contribuire

Grazie per l'interesse verso Local AI Desk.

## Prima di iniziare

- usa una issue per bug riproducibili o proposte con impatto ampio;
- non allegare documenti privati, credenziali, pesi di modelli o file di grandi dimensioni;
- per una vulnerabilità segui [SECURITY.md](SECURITY.md), senza aprire issue pubbliche;
- mantieni ogni pull request piccola, verificabile e focalizzata.

## Ambiente di sviluppo

Servono Node.js 20+, Rust stable e Python 3.12. Installa le dipendenze frontend
con `npm ci`, poi usa `npm run tauri dev`.

Prima di aprire una pull request esegui:

```bash
npm run build
(cd src-tauri && cargo fmt --check)
(cd src-tauri && cargo test)
(cd src-tauri && cargo clippy --all-targets -- -D warnings)
PYTHONPATH=engine python3 -m unittest discover -s engine/tests -v
```

## Licenza dei contributi

Inviando un contributo dichiari di avere il diritto di farlo e accetti che sia
distribuito con licenza AGPL-3.0-or-later. Le nuove dipendenze devono avere
origine, versione e licenza documentate.
