# Attributions & Third‑Party Notices

## Fonts

- Inter — used for UI text.
  - Source: Google Fonts (https://fonts.google.com/specimen/Inter)
  - Lizenz: SIL Open Font License (OFL) (prüfe die jeweilige Fontdatei für Details)

- Playfair Display — used for headings.
  - Source: Google Fonts (https://fonts.google.com/specimen/Playfair+Display)
  - Lizenz: SIL Open Font License (OFL) (prüfe die jeweilige Fontdatei für Details)

Hinweis: Die Fonts werden aktuell über Google Fonts eingebunden. Für maximale Rechtssicherheit kannst du die Font‑Dateien (.woff2) lokal im Ordner `/fonts` ablegen und die index.html so anpassen, dass die Fonts per `@font-face` geladen werden. Eine Beispiel‑Anleitung steht weiter unten.

---

## Assets

- Es befinden sich aktuell keine Vereinswappen, Liga‑Logos oder andere fremde Bilddateien im Repository.
- Wenn du zukünftig Logos/Bilder hinzufügst, prüfe vorab die Nutzungsbedingungen oder verwende lizenzfreie Alternativen (z. B. CC0, eigene Icons) bzw. hole eine schriftliche Erlaubnis ein.

---

## Datenquellen

- Aktuell werden Mock‑Daten lokal in `index.html` verwendet. Wenn du echte Spieldaten einbindest, dokumentiere die Quelle und überprüfe die API‑/Nutzungsbedingungen des Anbieters.

---

## Anleitung: Fonts lokal hosten (Kurzfassung)

1. Lade die benötigten .woff2 Dateien von den Font‑Anbietern herunter (Inter Regular, Inter 600/700, Playfair Display Regular/700).
2. Lege sie im Repo unter `/fonts/` ab (z. B. `/fonts/Inter-Regular.woff2`).
3. Ersetze in `index.html` den Google Fonts `<link>` mit lokalen `@font-face` Einträgen, z. B.: 

```css
@font-face {
  font-family: 'Inter';
  src: url('/fonts/Inter-Regular.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
```

4. Optional: Preload‑Links im `<head>` hinzufügen für bessere Performance:

```html
<link rel="preload" href="/fonts/Inter-Regular.woff2" as="font" type="font/woff2" crossorigin>
```

5. Committe die Font‑Dateien (achte auf Lizenz) und passe `ATTRIBUTIONS.md` an, falls nötig.

---

> Dieses Dokument ist eine Hilfestellung, keine Rechtsberatung. Bei unsicherer Lizenzlage konsultiere bitte einen Rechtsberater.
