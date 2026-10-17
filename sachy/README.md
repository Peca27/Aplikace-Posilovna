# Šachy ♞

Offline PWA šachy pro iPhone — hra proti počítači i pro dva hráče na jednom telefonu, s výkladem pravidel a nápovědou. Bez backendu, bez závislostí; po instalaci běží **úplně bez internetu**.

## Funkce

- **1 hráč proti počítači** — 4 úrovně (Začátečník, Hráč, Pokročilý, Mistr), hra za bílé, černé nebo náhodně
- **2 hráči** na jednom telefonu — volitelně se šachovnice otáčí k hráči na tahu
- **Kompletní pravidla** — rošáda, braní mimochodem, proměna pěšce (s výběrem figury), šach, mat, pat a remízy (nedostatek materiálu, trojí opakování, pravidlo 50 tahů)
- **💡 Nápověda** — šipka ukáže, *kterou figurkou a kam* táhnout, a karta vysvětlí proč (braní, šach, záchrana ohrožené figury, rošáda, rozvoj, známé zahájení…). Tlačítkem **Zahrát tah** se tah rovnou provede.
- **📖 Výklad pravidel** s diagramy — pohyb všech figurek, braní, šach a mat, pat, rošáda, braní mimochodem, proměna, remíza, hodnota figurek, rady pro začátečníky, šachová notace a ovládání aplikace
- **Zpět** (proti počítači vrátí i jeho odpověď), vzdání partie, česká notace tahů (`Jf3`, `Sxc6`, `O-O`), názvy zahájení, sebrané figury a materiální převaha
- Ovládání **klepnutím i tažením**, animace tahů, zvuky (WebAudio), tmavý režim, 4 barvy šachovnice
- Rozehraná partie se **ukládá automaticky** (`localStorage`) — aplikaci jde kdykoli zavřít

## Instalace na iPhone

PWA na iOS vyžaduje **HTTPS** — stejně jako Posilka přes GitHub Pages:

1. V repozitáři zapni **Settings → Pages → Deploy from a branch → main → / (root)**.
2. Na iPhonu otevři v Safari `https://<uzivatel>.github.io/<repozitar>/sachy/`.
3. Klepni na **Sdílet → Přidat na plochu**.
4. Aplikaci z plochy **jednou spusť s internetem** — service worker si uloží všechny soubory a od té doby běží celoobrazovkově a plně offline.

## Spuštění na počítači

Service worker i Web Worker vyžadují HTTP server:

```bash
python -m http.server 8123
```

Pak otevři `http://localhost:8123/sachy/`.

## Testy

```bash
node sachy/tests/engine.test.js        # perft, notace, konec hry, taktika AI, knihovna zahájení
FULL=1 node sachy/tests/engine.test.js # navíc hlubší perft (miliony pozic)
```

Generátor tahů je ověřený **perftem** na standardních testovacích pozicích (výchozí postavení, Kiwipete a další), který spolehlivě odhalí chyby v rošádě, braní mimochodem, proměnách i vazbách.

## Struktura

| Soubor | Účel |
|---|---|
| `index.html` | Kostra aplikace, spodní lišta, meta tagy pro iOS |
| `styles.css` | iOS vzhled, šachovnice, tmavý režim, safe-area, rozvržení pro iPad |
| `app.js` | Uživatelské rozhraní: šachovnice, tahy (klepnutí/tažení), nápověda, dialogy, ukládání |
| `engine.js` | Pravidla šachu a umělá inteligence (sdílené hlavním vláknem, workerem i testy) |
| `ai-worker.js` | Web Worker — počítač přemýšlí mimo hlavní vlákno, aplikace nezamrzá |
| `pieces.js` | SVG grafika figurek |
| `rules.js` | Text výkladu pravidel |
| `sw.js` | Service worker — cache-first, offline režim |
| `manifest.webmanifest` | PWA manifest |
| `icons/` | Ikony aplikace (180/192/512 px) |
| `tests/` | Testy enginu (Node.js, bez závislostí) |

Při vydání nové verze zvyš verzi cache v `sw.js` (`sachy-v1` → `sachy-v2`), aby se uživatelům obnovily soubory.

## Jak přemýšlí počítač

- Šachovnice 0x88, Zobristovo hashování, tahy s vracením (make/unmake)
- Alfa-beta (PVS) s iterativním prohlubováním a časovým limitem, transpoziční tabulka, klidové hledání (braní), null-move pruning, redukce pozdních tahů, řazení tahů (tah z tabulky, MVV-LVA, killer tahy, historie)
- Hodnocení: materiál a tabulky pozic (střední hra/koncovka), pěšcová struktura, volní pěšci, dvojice střelců, věže na otevřených sloupcích, pěšcový štít krále, zatlačení krále v koncovce
- Knihovna zahájení (Italská, Španělská, Sicilská, Francouzská, Dámský gambit, Královská indická…) pro pestré partie
- Slabší úrovně mají menší hloubku a náhodný „šum“ v hodnocení, takže dělají lidské chyby

## Licence figurek

Grafika figurek: Colin M. L. Burnett ([Wikimedia Commons](https://commons.wikimedia.org/wiki/Category:SVG_chess_pieces)), licence GPLv2+ / BSD / CC BY-SA 3.0.
