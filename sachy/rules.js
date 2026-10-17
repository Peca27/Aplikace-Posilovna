'use strict';

/* =====================================================
   Šachy — výklad pravidel (česky)
   Diagramy kreslí funkce `board(fen, opts)` z app.js:
   dots = kam lze táhnout, rings = braní, check = král v šachu,
   cross = zakázaná pole, arrows = šipky 'e2-e4', label = popisek.
   ===================================================== */

const RULES_TOC = [
  ['r-cil', '🎯 Cíl hry'],
  ['r-sachovnice', '🏁 Šachovnice'],
  ['r-figurky', '♞ Figurky'],
  ['r-brani', '⚔️ Braní'],
  ['r-sach', '⚠️ Šach a mat'],
  ['r-pat', '🤝 Pat'],
  ['r-rosada', '🏰 Rošáda'],
  ['r-mimochodem', '👣 Mimochodem'],
  ['r-promena', '✨ Proměna'],
  ['r-remiza', '🟰 Remíza'],
  ['r-hodnota', '⚖️ Hodnota'],
  ['r-rady', '💡 Rady'],
  ['r-notace', '📝 Notace'],
  ['r-aplikace', '📱 Aplikace'],
];

function rulesHtml(board) {
  const two = (a, b) => `<div class="diagrams two">${a}${b}</div>`;
  const one = (a) => `<div class="diagrams">${a}</div>`;

  return `
<section id="r-cil" class="rule">
  <h2>🎯 Cíl hry</h2>
  <p>Šachy hrají dva soupeři – <b>bílý</b> a <b>černý</b>. Každý začíná se 16 figurkami: králem, dámou, dvěma věžemi,
  dvěma střelci, dvěma jezdci a osmi pěšci. Hráči se v tazích pravidelně střídají a <b>bílý začíná</b>.
  V jednom tahu se táhne vždy jen jednou figurkou (jedinou výjimkou je rošáda).</p>
  <p class="callout">Cílem hry je dát soupeřovu králi <b>mat</b> – napadnout ho tak, aby se už nijak nemohl ubránit.
  Král se nikdy nebere; partie končí ve chvíli, kdy dostane mat.</p>
</section>

<section id="r-sachovnice" class="rule">
  <h2>🏁 Šachovnice a výchozí postavení</h2>
  <p>Šachovnice má 64 polí (8 × 8), světlá a tmavá se střídají. Svislé <b>sloupce</b> se značí písmeny <b>a–h</b>,
  vodorovné <b>řady</b> čísly <b>1–8</b>. Každé pole má tak své jméno – například <b>e4</b>.</p>
  ${one(board('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR', { label: 'Výchozí postavení' }))}
  <ul>
    <li>Šachovnice leží tak, aby měl každý hráč <b>vpravo dole světlé pole</b>.</li>
    <li>Věže stojí v rozích, vedle nich jezdci a pak střelci.</li>
    <li><b>Dáma stojí na poli své barvy</b> – bílá dáma na světlém poli d1, černá na tmavém d8.</li>
    <li>Král stojí vedle dámy – na e1, resp. e8.</li>
    <li>Celou druhou řadu zaplní pěšci.</li>
  </ul>
</section>

<section id="r-figurky" class="rule">
  <h2>♞ Jak táhnou figurky</h2>
  <p>Žádná figurka kromě jezdce nemůže <b>přeskakovat</b> jiné figurky. Na pole s vlastní figurkou táhnout nelze,
  na pole se soupeřovou figurkou ano – tím ji sebereš. Tečky v diagramech ukazují, kam figurka může táhnout.</p>

  <h3>Král <span class="tag">K</span></h3>
  <p>Táhne o <b>jedno pole libovolným směrem</b>. Nesmí ale vstoupit na pole, které napadá soupeř – král se nikdy
  nesmí sám vystavit šachu. Král je nejdůležitější figurka: když dostane mat, partie je prohraná.</p>
  ${one(board('8/8/8/8/4K3/8/8/8', { dots: 'd3 e3 f3 d4 f4 d5 e5 f5' }))}

  <h3>Dáma <span class="tag">D</span></h3>
  <p><b>Nejsilnější figurka.</b> Táhne o libovolný počet polí <b>rovně i šikmo</b> – vodorovně, svisle i po úhlopříčkách,
  dokud jí něco nestojí v cestě.</p>
  ${one(board('8/8/8/8/3Q4/8/8/8', { dots: 'a4 b4 c4 e4 f4 g4 h4 d1 d2 d3 d5 d6 d7 d8 a1 b2 c3 e5 f6 g7 h8 a7 b6 c5 e3 f2 g1' }))}

  <h3>Věž <span class="tag">V</span></h3>
  <p>Táhne o libovolný počet polí <b>rovně</b> – vodorovně nebo svisle.</p>
  ${one(board('8/8/8/8/3R4/8/8/8', { dots: 'a4 b4 c4 e4 f4 g4 h4 d1 d2 d3 d5 d6 d7 d8' }))}

  <h3>Střelec <span class="tag">S</span></h3>
  <p>Táhne o libovolný počet polí <b>šikmo</b>. Proto celou partii zůstává na polích jedné barvy – každý hráč má
  jednoho „světlopolného" a jednoho „tmavopolného" střelce.</p>
  ${one(board('8/8/8/8/3B4/8/8/8', { dots: 'a1 b2 c3 e5 f6 g7 h8 a7 b6 c5 e3 f2 g1' }))}

  <h3>Jezdec <span class="tag">J</span></h3>
  <p>Skáče do tvaru písmene <b>L</b>: o dvě pole rovně a o jedno stranou. Jako jediná figurka umí <b>přeskakovat</b>
  ostatní figurky – v diagramu ho pěšci kolem nezastaví. Při každém skoku změní barvu pole.</p>
  ${one(board('8/8/8/2PPP3/2PNP3/2PPP3/8/8', { dots: 'c2 e2 b3 f3 b5 f5 c6 e6' }))}

  <h3>Pěšec</h3>
  <p>Táhne jen <b>dopředu o jedno pole</b>. Ze svého výchozího pole (2. řada u bílého, 7. u černého) smí táhnout
  i <b>o dvě pole</b>. <b>Bere ale šikmo</b> – o jedno pole šikmo vpřed. Pěšec nikdy necouvá a nemůže sebrat figurku,
  která stojí přímo před ním (pak je zablokovaný).</p>
  ${one(board('8/8/2p1n3/3P4/7p/7P/4P3/8', { dots: 'e3 e4 d6', rings: 'c6 e6', label: 'Pěšec h3 je zablokovaný' }))}
</section>

<section id="r-brani" class="rule">
  <h2>⚔️ Braní</h2>
  <p>Když táhneš figurkou na pole, kde stojí soupeřova figurka, <b>sebereš ji</b> – zmizí ze šachovnice a do konce
  partie se nevrátí. Bere se stejným pohybem, jakým figurka táhne (jen pěšec bere jinak – šikmo).
  Brát se nemusí, je to dobrovolné.</p>
  ${one(board('8/p7/8/8/R3n3/8/8/8', { dots: 'b4 c4 d4 a5 a6 a3 a2 a1', rings: 'e4 a7', label: 'Věž může sebrat jezdce nebo pěšce' }))}
  <p class="callout">Kroužek v aplikaci znamená, že na tom poli můžeš brát.</p>
</section>

<section id="r-sach" class="rule">
  <h2>⚠️ Šach</h2>
  <p>Když figurka napadá soupeřova krále, je král <b>v šachu</b>. Hráč musí šach <b>okamžitě odvrátit</b>
  jedním ze tří způsobů:</p>
  <ol>
    <li><b>ustoupit</b> králem na bezpečné pole,</li>
    <li><b>sebrat</b> figurku, která šach dává,</li>
    <li><b>zakrýt</b> šach – postavit jinou figurku mezi krále a útočníka.</li>
  </ol>
  ${one(board('4k3/8/8/8/8/8/8/4R1K1', { check: 'e8', arrows: 'e1-e8', label: 'Věž dává šach černému králi' }))}
  <p>Tah, po kterém by vlastní král zůstal v šachu (nebo se do něj dostal), je zakázaný – aplikace ho ani nedovolí.</p>

  <h2>🏆 Mat</h2>
  <p>Šach, ze kterého se nedá nijak uniknout, je <b>mat</b>. Partie okamžitě končí a hráč, který mat dal, <b>vyhrál</b>.</p>
  ${two(
    board('R5k1/5ppp/8/8/8/8/5PPP/6K1', { check: 'g8', arrows: 'a1-a8', label: 'Mat na poslední řadě' }),
    board('r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR', { check: 'e8', arrows: 'h5-f7', label: 'Ovčácký mat' })
  )}
  <p>Vlevo: černého krále uvěznili vlastní pěšci a věž mu dala mat. Vpravo: <b>ovčácký mat</b> – dáma podporovaná
  střelcem útočí na slabé pole f7. Hlídej ho hlavně na začátku partie!</p>
</section>

<section id="r-pat" class="rule">
  <h2>🤝 Pat</h2>
  <p>Když hráč, který je na tahu, <b>nemá žádný povolený tah</b> a jeho král přitom <b>není v šachu</b>, nastává
  <b>pat</b>. Pat znamená <b>remízu</b> – nikdo nevyhrál.</p>
  ${one(board('7k/5Q2/6K1/8/8/8/8/8', { cross: 'g8 g7 h7', label: 'Černý je na tahu – pat' }))}
  <p class="callout">Pozor na pat, hlavně když máš velkou převahu! V diagramu by bílý místo výhry dal jen remízu.</p>
</section>

<section id="r-rosada" class="rule">
  <h2>🏰 Rošáda</h2>
  <p>Rošáda je jediný tah, ve kterém se táhne dvěma figurkami najednou – <b>králem a věží</b>. Král se posune
  o <b>dvě pole</b> směrem k věži a věž ho <b>přeskočí</b> a postaví se hned vedle něj.</p>
  ${two(
    board('4k3/8/8/8/8/8/5PPP/4K2R', { arrows: 'e1-g1 h1-f1', label: 'Před malou rošádou' }),
    board('4k3/8/8/8/8/8/5PPP/5RK1', { label: 'Po malé rošádě' })
  )}
  <ul>
    <li><b>Malá rošáda</b> (O-O) – s věží na straně krále (h1 / h8).</li>
    <li><b>Velká rošáda</b> (O-O-O) – s věží na straně dámy (a1 / a8); král jde na c1, věž na d1.</li>
  </ul>
  <p>Rošádu smíš udělat jen tehdy, když:</p>
  <ol>
    <li>král ani tato věž v partii <b>ještě netáhli</b>,</li>
    <li>mezi králem a věží <b>nic nestojí</b>,</li>
    <li>král <b>není v šachu</b>,</li>
    <li>král <b>nepřechází přes napadené pole</b> a rošádou se nedostane do šachu.</li>
  </ol>
  <p class="callout">V aplikaci klepni na krále a pak na pole, kam se má posunout (g1 nebo c1). Věž přeskočí sama.</p>
</section>

<section id="r-mimochodem" class="rule">
  <h2>👣 Braní mimochodem</h2>
  <p>Zvláštní pravidlo pro pěšce. Když soupeřův pěšec vyrazí z výchozího pole <b>o dvě pole</b> a zastaví se
  <b>vedle tvého pěšce</b>, můžeš ho sebrat, jako by táhl jen o jedno pole. Tvůj pěšec skončí na poli,
  které soupeřův pěšec přeskočil.</p>
  ${two(
    board('8/8/8/3pP3/8/8/8/8', { arrows: 'd7-d5', label: 'Černý táhl d7–d5' }),
    board('8/8/8/3pP3/8/8/8/8', { arrows: 'e5-d6', rings: 'd5', dots: 'd6', label: 'Bílý bere exd6' })
  )}
  <p class="callout">Brát mimochodem můžeš <b>jen hned v následujícím tahu</b> – později už to nejde.</p>
</section>

<section id="r-promena" class="rule">
  <h2>✨ Proměna pěšce</h2>
  <p>Pěšec, který dojde až na <b>poslední řadu</b> (bílý na 8., černý na 1.), se <b>promění</b> v dámu, věž, střelce
  nebo jezdce své barvy – podle tvého výběru. Nejčastěji se volí dáma, protože je nejsilnější.
  Klidně tak můžeš mít i dvě dámy.</p>
  ${one(board('k7/4P3/8/8/8/8/8/K7', { arrows: 'e7-e8', label: 'Pěšec se na e8 promění' }))}
</section>

<section id="r-remiza" class="rule">
  <h2>🟰 Remíza</h2>
  <p>Partie může skončit nerozhodně – <b>remízou</b>. Stane se to, když:</p>
  <ul>
    <li><b>Pat</b> – hráč na tahu nemá žádný povolený tah, ale není v šachu.</li>
    <li><b>Nedostatek materiálu</b> – nikdo už nemůže dát mat (např. zbyli jen dva králové, nebo král se střelcem
    či jezdcem proti samotnému králi).</li>
    <li><b>Trojí opakování</b> – stejná pozice se na šachovnici objeví potřetí.</li>
    <li><b>Pravidlo 50 tahů</b> – 50 tahů za sebou (každého hráče) nikdo nebral ani netáhl pěšcem.</li>
    <li><b>Dohoda</b> – hráči se na remíze domluví.</li>
  </ul>
  <p>Aplikace remízu (kromě dohody) pozná a ohlásí sama.</p>
</section>

<section id="r-hodnota" class="rule">
  <h2>⚖️ Hodnota figurek</h2>
  <p>Aby se dalo posoudit, zda se výměna vyplatí, mají figurky přibližnou hodnotu v bodech:</p>
  <table class="values">
    <tr><td>${pieceIcon('wP')}</td><td>Pěšec</td><td>1</td></tr>
    <tr><td>${pieceIcon('wN')}</td><td>Jezdec</td><td>3</td></tr>
    <tr><td>${pieceIcon('wB')}</td><td>Střelec</td><td>3</td></tr>
    <tr><td>${pieceIcon('wR')}</td><td>Věž</td><td>5</td></tr>
    <tr><td>${pieceIcon('wQ')}</td><td>Dáma</td><td>9</td></tr>
    <tr><td>${pieceIcon('wK')}</td><td>Král</td><td>∞</td></tr>
  </table>
  <p>Dát jezdce (3) za věž (5) se vyplatí, dát dámu (9) za věž (5) ne. Aplikace u hráčů ukazuje sebrané figurky
  a materiálovou převahu, např. <b>+2</b>.</p>
</section>

<section id="r-rady" class="rule">
  <h2>💡 Rady pro začátečníky</h2>
  <ol class="tips">
    <li><b>Ovládni střed.</b> Na začátku táhni pěšci na e4 a d4 (černý na e5 a d5) – figurky ze středu dosáhnou nejdál.</li>
    <li><b>Rozvíjej figurky.</b> Co nejdřív vyveď jezdce a střelce z první řady. Netahej jednou figurkou několikrát za sebou.</li>
    <li><b>Udělej rošádu.</b> Schováš krále do bezpečí a zapojíš věž.</li>
    <li><b>Nevytahuj dámu příliš brzy.</b> Soupeř ji bude honit a sám se přitom rozvine.</li>
    <li><b>Než táhneš, rozhlédni se.</b> Co ohrožuje soupeř? Nenechávej figurky nechráněné.</li>
    <li><b>Hledej šachy, braní a hrozby</b> – svoje i soupeřovy.</li>
    <li><b>Měň figurky, když vedeš.</b> S materiální převahou se výměny vyplácejí.</li>
    <li><b>Hraj až do konce.</b> I v horší pozici může soupeř chybovat – nebo dát pat.</li>
  </ol>
</section>

<section id="r-notace" class="rule">
  <h2>📝 Šachová notace</h2>
  <p>Tahy se zapisují písmenem figurky a polem, kam táhla. V češtině se používají písmena
  <b>K</b> = král, <b>D</b> = dáma, <b>V</b> = věž, <b>S</b> = střelec, <b>J</b> = jezdec; pěšec písmeno nemá.</p>
  <table class="notation">
    <tr><td><code>Jf3</code></td><td>jezdec táhne na f3</td></tr>
    <tr><td><code>e4</code></td><td>pěšec táhne na e4</td></tr>
    <tr><td><code>Sxc6</code></td><td>střelec bere na c6 (x = braní)</td></tr>
    <tr><td><code>exd5</code></td><td>pěšec ze sloupce e bere na d5</td></tr>
    <tr><td><code>O-O</code></td><td>malá rošáda</td></tr>
    <tr><td><code>O-O-O</code></td><td>velká rošáda</td></tr>
    <tr><td><code>e8=D</code></td><td>proměna pěšce v dámu</td></tr>
    <tr><td><code>+</code> / <code>#</code></td><td>šach / mat</td></tr>
  </table>
  <p>Například <code>1. e4 e5 2. Jf3 Jc6 3. Sc4</code> je začátek Italské hry. Tahy partie najdeš v aplikaci
  pod šachovnicí.</p>
</section>

<section id="r-aplikace" class="rule">
  <h2>📱 Jak ovládat aplikaci</h2>
  <ul>
    <li><b>Tah:</b> klepni na figurku – tečky ukážou, kam může táhnout (kroužek = braní). Pak klepni na cílové pole.
    Figurku můžeš i přetáhnout prstem.</li>
    <li><b>💡 Nápověda:</b> když nevíš, jak dál, klepni na Nápovědu. Šipka ukáže, <b>kterou figurkou a kam</b> táhnout,
    a dozvíš se proč. Tlačítkem <b>Zahrát tah</b> ho rovnou provedeš.</li>
    <li><b>Zpět:</b> vrátí poslední tah (při hře s počítačem i jeho odpověď).</li>
    <li><b>Nová hra:</b> hra proti počítači (4 úrovně obtížnosti, hraješ za bílé, černé nebo náhodně) nebo hra
    dvou hráčů na jednom telefonu.</li>
    <li><b>Možnosti:</b> otočení šachovnice, zvuky, barvy šachovnice nebo vzdání partie.</li>
    <li>Rozehraná partie se <b>ukládá sama</b> – aplikaci můžeš kdykoli zavřít a později pokračovat.</li>
    <li>Aplikace funguje <b>úplně bez internetu</b>.</li>
  </ul>
</section>`;
}
