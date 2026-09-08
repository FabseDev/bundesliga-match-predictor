# bundesliga-match-predictor
Webapp zur Vorhersage der wahrscheinlichsten Ergebnisse für den kommenden Bundesligaspieltag


## Fonts (lokales Hosting)

Dieses Projekt lädt die UI‑Schriftarten lokal aus dem Verzeichnis `/fonts`.
Um die benötigten `.woff2` Dateien herunterzuladen, führe das mitgelieferte Skript aus:

```bash
chmod +x fetch-fonts.sh
./fetch-fonts.sh
```

Das Skript lädt die benötigten `.woff2` Dateien in das Verzeichnis `/fonts`. Prüfe nach dem Download bitte die enthaltenen Lizenzhinweise der Fonts (ATTRIBUTIONS.md) und committe die Dateien in dein Repo, z. B.:

```bash
git add fonts/*
git commit -m "Add locally hosted fonts"
git push
```

Hinweis: Falls du die Fonts manuell herunterlädst, lege sie unter `/fonts` ab und committe sie.
