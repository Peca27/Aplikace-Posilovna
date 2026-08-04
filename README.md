# Posilka 🏋️

Offline PWA deník posilování s iOS vzhledem — bez backendu, bez závislostí. Data se ukládají jen do zařízení (`localStorage`).

## Funkce

- **Záznam tréninku** — výběr cviku, série × opakování × váha, odškrtávání hotových sérií
- **Stopky mezi sériemi** — spustí se automaticky po odškrtnutí série (výchozí 90 s, lze změnit v Nastavení), se zvukovým signálem
- **Progressive overload** — pokud minule splníš cíl (např. 5×5), aplikace navrhne **+2,5 kg u vršku** / **+5 kg u spodku těla**; váha se rovnou předvyplní
- **Historie** — seznam tréninků s detailem sérií a celkovým objemem
- **Statistiky** — čárový graf vývoje váhy u cviku, osobní rekord, celkový posun
- **Vlastní cviky** — přidání/úprava/smazání, cílové schéma sérií a opakování
- **Záloha** — export/import dat do souboru JSON (Cviky → Nastavení)
- **Dark Mode** — automaticky podle systému

## Spuštění na počítači

Service worker vyžaduje HTTP server (ne otevření souboru napřímo):

```bash
python -m http.server 8123
```

Pak otevři `http://localhost:8123`.

## Instalace na iPhone

PWA na iOS vyžaduje **HTTPS** — nejjednodušší je zdarma přes GitHub Pages:

1. Vytvoř repozitář na GitHubu a nahraj do něj obsah této složky.
2. V repozitáři: **Settings → Pages → Source: Deploy from a branch → main → / (root)**.
3. Na iPhonu otevři adresu `https://<uzivatel>.github.io/<repozitar>/` v Safari.
4. Klepni na **Sdílet → Přidat na plochu** (aplikace to sama napoví).

Po instalaci běží aplikace celoobrazovkově a **plně offline** — vše je nakešované service workerem.

> ⚠️ Data žijí jen v prohlížeči daného zařízení. Občas si udělej **Export** zálohy (Cviky → Nastavení), např. při mazání dat Safari by ses o záznamy přišel.

## Struktura

| Soubor | Účel |
|---|---|
| `index.html` | Kostra aplikace, spodní navigace, meta tagy pro iOS |
| `styles.css` | iOS vzhled (karty, blur tab bar, dark mode, safe-area) |
| `app.js` | Veškerá logika: záznam, progrese, stopky, graf (SVG), export/import |
| `sw.js` | Service worker — cache-first, offline režim |
| `manifest.webmanifest` | PWA manifest (název, ikony, standalone režim) |
| `icons/` | Ikony aplikace (180/192/512 px) |

Při vydání nové verze aplikace zvyš verzi cache v `sw.js` (`posilka-v1` → `posilka-v2`), aby se uživatelům obnovily soubory.
