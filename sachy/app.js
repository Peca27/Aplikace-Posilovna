'use strict';

/* =====================================================
   Šachy — offline PWA pro jednoho nebo dva hráče
   Pravidla a AI: engine.js (+ ai-worker.js), figurky: pieces.js,
   výklad pravidel: rules.js. Data: localStorage, prefix "sachy."
   ===================================================== */

const {
  WHITE, BLACK, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING,
  F_CAPTURE, F_EP, F_CASTLE, START_FEN, MATE, MATE_BOUND,
  moveFrom, moveTo, movePromo, moveFlags, moveToUci, sqName, sqFromName,
} = Chess;

// ---------- Úložiště ----------
const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem('sachy.' + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem('sachy.' + key, JSON.stringify(value));
    } catch { /* plné nebo zakázané úložiště */ }
  },
};

// ---------- Úrovně a nastavení ----------
const LEVELS = [
  { name: 'Začátečník', icon: '🐣', desc: 'Často chybuje – ideální na první partie.', opts: { maxDepth: 1, timeMs: 500, noise: 250 }, book: false },
  { name: 'Hráč', icon: '🙂', desc: 'Hraje rozumně, občas přehlédne hrozbu.', opts: { maxDepth: 2, timeMs: 700, noise: 80 }, book: true },
  { name: 'Pokročilý', icon: '😎', desc: 'Silný soupeř, přemýšlí asi sekundu.', opts: { maxDepth: 4, timeMs: 1200, noise: 15 }, book: true },
  { name: 'Mistr', icon: '🧠', desc: 'Nejsilnější úroveň, přemýšlí až 3 sekundy.', opts: { maxDepth: 40, timeMs: 3000, noise: 0 }, book: true },
];
const HINT_OPTS = { maxDepth: 40, timeMs: 1500, noise: 0 };

const BOARD_THEMES = [
  ['wood', 'Dřevo'],
  ['green', 'Zelená'],
  ['blue', 'Modrá'],
  ['gray', 'Šedá'],
];

const DEFAULT_SETTINGS = { showMoves: true, coords: true, sound: true, autoFlip: false, theme: 'wood' };
let settings = Object.assign({}, DEFAULT_SETTINGS, store.get('settings', {}));
const saveSettings = () => store.set('settings', settings);

// české názvy figur v pádech
const PIECE_CS = [
  null,
  { nom: 'pěšec', ins: 'pěšcem', acc: 'pěšce', fem: false },
  { nom: 'jezdec', ins: 'jezdcem', acc: 'jezdce', fem: false },
  { nom: 'střelec', ins: 'střelcem', acc: 'střelce', fem: false },
  { nom: 'věž', ins: 'věží', acc: 'věž', fem: true },
  { nom: 'dáma', ins: 'dámou', acc: 'dámu', fem: true },
  { nom: 'král', ins: 'králem', acc: 'krále', fem: false },
];
const SIDE_CS = ['bílý', 'černý'];
const POINTS = [0, 1, 3, 3, 5, 9, 0];

// ---------- Stav ----------
// game: { mode: 1|2, human: WHITE|BLACK, level: 0–3, moves: ['e2e4', …], flip, resigned: -1|barva, endShown }
let game = null;
let pos = null; // Chess.Position aktuální partie
let sans = []; // notace odehraných tahů
let status = null; // výsledek pos.status()
let selected = -1; // vybrané pole
let hint = null; // { loading } | { move, title, reasons }
let aiThinking = false;
let aiToken = 0;
let hintToken = 0;
let pendingAnim = null; // tah k animaci po vykreslení
let newGameDraft = null;
let promoAnimate = false; // animovat tah po výběru proměny

const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const saveGame = () => store.set('game', game);
const isOver = () => status.over || game.resigned >= 0;
const winner = () => (game.resigned >= 0 ? game.resigned ^ 1 : status.winner);
const isFlipped = () => {
  let f = game.mode === 1 ? game.human === BLACK : settings.autoFlip && pos.turn === BLACK;
  return game.flip ? !f : f;
};
const canHumanMove = () =>
  !isOver() && !aiThinking && (game.mode === 2 || pos.turn === game.human);

// ---------- Figurky do CSS ----------
(function injectPieceStyles() {
  const css = Object.keys(PIECE_SVG)
    .map((k) => `.pc.${k},.mini-pc.${k}{background-image:url("${pieceDataUrl(k)}")}`)
    .join('\n');
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
})();

const pieceIcon = (key) => `<span class="mini-pc ${key}"></span>`;

// ---------- Partie ----------
function loadGame() {
  const saved = store.get('game', null);
  game = Object.assign(
    { mode: 1, human: WHITE, level: 1, moves: [], flip: false, resigned: -1, endShown: false },
    saved && Array.isArray(saved.moves) ? saved : {}
  );
  rebuild();
}

// přehraje uložené tahy od výchozího postavení
function rebuild() {
  pos = new Chess.Position(START_FEN);
  sans = [];
  const valid = [];
  for (const u of game.moves) {
    const m = pos.moveFromUci(u);
    if (!m) break;
    sans.push(pos.san(m));
    pos.makeMove(m);
    valid.push(u);
  }
  game.moves = valid;
  status = pos.status();
}

function newGame(opts) {
  cancelThinking();
  const human = opts.color === 'r' ? (Math.random() < 0.5 ? WHITE : BLACK) : Number(opts.color) || WHITE;
  game = { mode: opts.mode, human, level: opts.level, moves: [], flip: false, resigned: -1, endShown: false };
  selected = -1;
  hint = null;
  rebuild();
  saveGame();
  render();
  scheduleAi();
}

function applyMove(m, animate) {
  const san = pos.san(m, undefined, status.moves);
  const flags = moveFlags(m);
  pendingAnim = animate ? m : null;
  pos.makeMove(m);
  game.moves.push(moveToUci(m));
  sans.push(san);
  selected = -1;
  if (hint && hint.loading) engine.cancel();
  hint = null;
  hintToken++;
  status = pos.status();
  saveGame();
  render();

  if (status.over) sound('end');
  else if (status.check) sound('check');
  else if (flags & F_CAPTURE) sound('capture');
  else sound('move');

  if (isOver()) setTimeout(showGameOver, 600);
  else scheduleAi();
}

// tah z pole na pole (klepnutím nebo tažením); vrací true, pokud byl platný
function tryMove(from, to, animate) {
  const cands = status.moves.filter((m) => moveFrom(m) === from && moveTo(m) === to);
  if (!cands.length) return false;
  if (cands.length > 1) askPromotion(cands, animate);
  else applyMove(cands[0], animate);
  return true;
}

// kolik tahů vrátit: ve hře dvou hráčů jeden, proti počítači až po poslední tah člověka
function undoCount() {
  const n = game.moves.length;
  if (game.mode === 2) return n ? 1 : 0;
  for (let i = n - 1; i >= 0; i--) {
    if (i % 2 === game.human) return n - i; // partie začíná bílým: sudé tahy hraje bílý
  }
  return 0;
}

function undo() {
  const k = undoCount();
  if (!k) return;
  cancelThinking();
  closeSheet();
  game.moves.splice(game.moves.length - k, k);
  game.resigned = -1;
  game.endShown = false;
  selected = -1;
  hint = null;
  rebuild();
  saveGame();
  render();
  scheduleAi();
}

function resign() {
  if (isOver() || !game.moves.length) return;
  cancelThinking();
  game.resigned = game.mode === 1 ? game.human : pos.turn;
  saveGame();
  closeSheet();
  render();
  sound('end');
  setTimeout(showGameOver, 350);
}

// ---------- Počítač (Web Worker se zálohou v hlavním vlákně) ----------
const engine = {
  worker: null,
  failed: false,
  seq: 0,
  pending: null,
  local: null,

  start() {
    if (this.worker || this.failed) return;
    try {
      this.worker = new Worker('ai-worker.js');
      this.worker.onmessage = (ev) => {
        const p = this.pending;
        if (!p || ev.data.id !== p.id) return;
        this.pending = null;
        p.resolve(ev.data);
      };
      this.worker.onerror = (ev) => {
        if (ev && ev.preventDefault) ev.preventDefault();
        if (this.worker) this.worker.terminate();
        this.worker = null;
        this.failed = true;
        if (this.pending) this.runLocal(this.pending);
      };
    } catch {
      this.worker = null;
      this.failed = true;
    }
  },

  request(moves, opts) {
    this.cancel();
    this.start();
    return new Promise((resolve, reject) => {
      const p = { id: ++this.seq, moves: moves.slice(), opts, resolve, reject };
      this.pending = p;
      if (this.worker) {
        this.worker.postMessage({ id: p.id, fen: START_FEN, moves: p.moves, opts });
        // pojistka: když worker neodpoví, dopočítá se tah v hlavním vlákně
        setTimeout(() => {
          if (this.pending !== p || !this.worker) return;
          this.worker.terminate();
          this.worker = null;
          this.failed = true;
          this.runLocal(p);
        }, (opts.timeMs || 1000) + 10000);
      } else {
        this.runLocal(p);
      }
    });
  },

  runLocal(p) {
    setTimeout(() => {
      if (this.pending !== p) return;
      this.local = this.local || new Chess.Searcher();
      const lp = new Chess.Position(START_FEN);
      for (const u of p.moves) {
        const m = lp.moveFromUci(u);
        if (!m) break;
        lp.makeMove(m);
      }
      const res = this.local.think(lp, p.opts);
      if (this.pending !== p) return;
      this.pending = null;
      p.resolve({ id: p.id, move: res ? moveToUci(res.move) : null, score: res ? res.score : 0 });
    }, 60);
  },

  cancel() {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    p.reject(new Error('zrušeno'));
    // ukončí rozběhnuté hledání; při dalším požadavku se worker spustí znovu
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  },
};

function scheduleAi() {
  if (game.mode !== 1 || isOver() || pos.turn === game.human) return;
  const token = ++aiToken;
  const level = LEVELS[game.level] || LEVELS[1];
  aiThinking = true;
  render();
  const t0 = Date.now();
  const book = level.book ? Chess.bookMove(game.moves) : null;
  const req = book ? Promise.resolve({ move: book }) : engine.request(game.moves, level.opts);
  req.then((res) => {
    const wait = Math.max(0, (book ? 650 : 300) - (Date.now() - t0));
    setTimeout(() => {
      if (token !== aiToken) return;
      aiThinking = false;
      const m = res.move ? pos.moveFromUci(res.move) : 0;
      if (m) applyMove(m, true);
      else render();
    }, wait);
  }).catch(() => { /* zrušeno */ });
}

function cancelThinking() {
  aiToken++;
  hintToken++;
  aiThinking = false;
  if (hint && hint.loading) hint = null;
  engine.cancel();
}

// ---------- Nápověda ----------
function requestHint() {
  if (!canHumanMove() || (hint && hint.loading)) return;
  selected = -1;
  const token = ++hintToken;
  const book = Chess.bookMove(game.moves);
  if (book) {
    const m = pos.moveFromUci(book);
    hint = buildHint(m, 0, { name: Chess.openingName(game.moves.concat(book)) });
    render();
    return;
  }
  hint = { loading: true };
  render();
  engine.request(game.moves, HINT_OPTS).then((res) => {
    if (token !== hintToken) return;
    const m = res.move ? pos.moveFromUci(res.move) : 0;
    hint = m ? buildHint(m, res.score, null) : null;
    render();
  }).catch(() => { /* zrušeno */ });
}

// je figurka na poli `sq` v nebezpečí? (napadená a nekrytá, nebo napadená levnější figurkou)
function inDanger(sq) {
  const p = pos.board[sq];
  if (!p || (p & 7) === KING) return false;
  const side = p >> 3;
  const defended = pos.isAttacked(sq, side);
  return pos.attackers(sq, side ^ 1).some((a) => {
    const t = pos.board[a] & 7;
    return !defended || (t !== KING && POINTS[t] < POINTS[p & 7]);
  });
}

// vysvětlení doporučeného tahu česky; book = { name } u tahu z knihovny zahájení
function buildHint(m, score, book) {
  const from = moveFrom(m), to = moveTo(m), flags = moveFlags(m), promo = movePromo(m);
  const piece = pos.board[from], t = piece & 7;
  const us = pos.turn, them = us ^ 1;
  const names = PIECE_CS[t];
  const title = flags & F_CASTLE
    ? `Udělej ${to > from ? 'malou' : 'velkou'} rošádu – král z ${sqName(from)} na ${sqName(to)}`
    : `Táhni ${names.ins} z ${sqName(from)} na ${sqName(to)}`;

  const captured = flags & F_EP ? PAWN : pos.board[to] & 7;
  const wasCheck = status.check;
  const dangerBefore = inDanger(from);
  const minorDevelop = (t === KNIGHT || t === BISHOP) && (from >> 4) === (us === WHITE ? 0 : 7);

  pos.makeMove(m);
  const givesCheck = pos.inCheck();
  const mate = givesCheck && !pos.hasLegalMove();
  const dangerAfter = inDanger(to);
  // napadené soupeřovy figurky, které nejsou kryté nebo jsou cennější
  const myValue = t === KING ? 99 : POINTS[promo || t];
  const targets = pos.attacksFrom(to).filter((s) => {
    const q = pos.board[s];
    if (!q || (q >> 3) !== them || (q & 7) === KING) return false;
    return POINTS[q & 7] > myValue || !pos.isAttacked(s, them);
  });
  pos.unmakeMove();

  const reasons = [];
  if (mate) {
    reasons.push('Je to <b>mat</b> – tímto tahem partii vyhraješ! 🏆');
  } else {
    if (book) {
      reasons.push(book.name
        ? `Známý zahajovací tah – <b>${esc(book.name)}</b>.`
        : 'Oblíbený zahajovací tah, který hrají i mistři.');
    }
    if (wasCheck) reasons.push('Tvůj král je <b>v šachu</b> – tento tah ho zachrání.');
    if (flags & F_CASTLE) reasons.push('Rošáda schová krále do bezpečí a zapojí věž do hry.');
    if (promo) reasons.push(`Pěšec dojde na poslední řadu a promění se v ${PIECE_CS[promo].acc}.`);
    if (captured) reasons.push(`Sebereš soupeři ${PIECE_CS[captured].acc}${dangerAfter ? '' : ' a nic za to neztratíš'}.`);
    if (givesCheck) reasons.push('Dáš soupeři <b>šach</b>.');
    if (!captured && !wasCheck && dangerBefore && !dangerAfter) {
      reasons.push(`Tv${names.fem ? 'oje' : 'ůj'} ${names.nom} je v ohrožení – tímto tahem ${names.fem ? 'ji' : 'ho'} zachráníš.`);
    }
    if (!givesCheck && targets.length) {
      const best = targets.sort((a, b) => POINTS[pos.board[b] & 7] - POINTS[pos.board[a] & 7])[0];
      const q = PIECE_CS[pos.board[best] & 7];
      reasons.push(`Napadneš soupeř${q.fem ? 'ovu' : 'ova'} ${q.acc} na ${sqName(best)}.`);
    }
    if (!reasons.length) {
      if (minorDevelop && game.moves.length < 24) reasons.push('Rozvineš figuru – v zahájení je důležité dostat jezdce a střelce do hry.');
      else if (t === PAWN && [51, 52, 67, 68].includes(to)) reasons.push('Pěšec obsadí střed šachovnice.');
      else if (t === PAWN && (us === WHITE ? to >> 4 >= 5 : to >> 4 <= 2)) reasons.push('Posuneš pěšce blíž k proměně.');
    }
    if (score > MATE_BOUND) {
      const n = Math.ceil((MATE - score) / 2);
      reasons.push(`Vede k vynucenému matu za ${n} ${n < 5 ? 'tahy' : 'tahů'}.`);
    } else if (score < -MATE_BOUND) {
      reasons.push('Pozice je bohužel ztracená, ale tímto tahem se bráníš nejdéle.');
    }
    if (!reasons.length) reasons.push('Počítač tento tah vyhodnotil jako nejlepší – zlepší postavení tvých figurek.');
  }
  return { move: m, title, reasons };
}

function playHint() {
  if (!hint || !hint.move || !canHumanMove()) return;
  const m = hint.move;
  if (movePromo(m)) applyMove(m, true);
  else tryMove(moveFrom(m), moveTo(m), true);
}

// ---------- Zvuky (WebAudio, bez souborů) ----------
let audioCtx = null;

function unlockAudio() {
  if (!settings.sound) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch { /* zvuk není k dispozici */ }
}

function sound(kind) {
  if (!settings.sound) return;
  unlockAudio();
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  const tone = (freq, start, dur, vol, type) => {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type || 'triangle';
    o.frequency.setValueAtTime(freq, t + start);
    g.gain.setValueAtTime(0.0001, t + start);
    g.gain.exponentialRampToValueAtTime(vol, t + start + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + start + dur);
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start(t + start);
    o.stop(t + start + dur + 0.03);
  };
  if (kind === 'move') { tone(330, 0, 0.09, 0.22); tone(660, 0, 0.04, 0.06, 'sine'); }
  else if (kind === 'capture') { tone(220, 0, 0.12, 0.3); tone(440, 0.01, 0.08, 0.12); }
  else if (kind === 'check') { tone(660, 0, 0.12, 0.18, 'sine'); tone(880, 0.1, 0.16, 0.16, 'sine'); }
  else if (kind === 'end') { tone(523, 0, 0.18, 0.16, 'sine'); tone(659, 0.14, 0.18, 0.16, 'sine'); tone(784, 0.28, 0.32, 0.16, 'sine'); }
}

// ---------- Vykreslení: šachovnice ----------
const colOf = (sq, flipped) => (flipped ? 7 - (sq & 7) : sq & 7);
const rowOf = (sq, flipped) => (flipped ? sq >> 4 : 7 - (sq >> 4));

function renderBoard() {
  const flipped = isFlipped();
  const last = pos.ply ? pos.uMove[pos.ply - 1] : 0;
  const lastFrom = last ? moveFrom(last) : -1, lastTo = last ? moveTo(last) : -1;
  const checkSq = status.check ? pos.kings[pos.turn] : -1;
  const targets = new Map();
  if (selected >= 0) for (const m of status.moves) if (moveFrom(m) === selected) targets.set(moveTo(m), m);
  const hintFrom = hint && hint.move ? moveFrom(hint.move) : -1;
  const hintTo = hint && hint.move ? moveTo(hint.move) : -1;

  let html = '';
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const r = flipped ? row : 7 - row;
      const f = flipped ? 7 - col : col;
      const sq = r * 16 + f;
      const p = pos.board[sq];
      const cls = ['sq', (r + f) % 2 ? 'light' : 'dark'];
      if (sq === lastFrom || sq === lastTo) cls.push('last');
      if (sq === selected) cls.push('sel');
      if (sq === checkSq) cls.push('check');
      if (sq === hintFrom) cls.push('hint-from');
      if (sq === hintTo) cls.push('hint-to');
      if (targets.has(sq) && settings.showMoves) cls.push(p || (moveFlags(targets.get(sq)) & F_EP) ? 'target cap' : 'target');
      let inner = p ? `<div class="pc ${pieceKey(p)}"></div>` : '';
      if (settings.coords) {
        if (row === 7) inner += `<span class="cf">${'abcdefgh'[f]}</span>`;
        if (col === 0) inner += `<span class="cr">${r + 1}</span>`;
      }
      html += `<div class="${cls.join(' ')}" data-sq="${sq}">${inner}</div>`;
    }
  }
  const board = $('#board');
  board.innerHTML = html;
  board.dataset.board = settings.theme;
  board.classList.toggle('can-move', canHumanMove());

  // šipka nápovědy
  $('#arrows').innerHTML = hint && hint.move
    ? arrowSvg(colOf(hintFrom, flipped) + 0.5, rowOf(hintFrom, flipped) + 0.5, colOf(hintTo, flipped) + 0.5, rowOf(hintTo, flipped) + 0.5, 'hint-arrow')
    : '';

  if (pendingAnim) {
    animateMove(pendingAnim, flipped);
    pendingAnim = null;
  }
}

// plynulý přesun figurky z výchozího pole (po klepnutí nebo tahu počítače)
function animateMove(m, flipped) {
  const slide = (from, to) => {
    const el = document.querySelector(`#board [data-sq="${to}"] .pc`);
    if (!el) return;
    const dx = colOf(from, flipped) - colOf(to, flipped);
    const dy = rowOf(from, flipped) - rowOf(to, flipped);
    el.style.transition = 'none';
    el.style.transform = `translate(${dx * 100}%, ${dy * 100}%)`;
    el.style.zIndex = 5;
    void el.offsetWidth;
    el.style.transition = 'transform 0.2s cubic-bezier(0.3, 0.7, 0.4, 1)';
    el.style.transform = '';
    el.addEventListener('transitionend', () => { el.style.zIndex = ''; }, { once: true });
  };
  const from = moveFrom(m), to = moveTo(m);
  slide(from, to);
  if (moveFlags(m) & F_CASTLE) {
    slide(to > from ? from + 3 : from - 4, to > from ? from + 1 : from - 1);
  }
}

function arrowSvg(x1, y1, x2, y2, cls) {
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
  const ux = dx / len, uy = dy / len, px = -uy, py = ux;
  const sw = 0.1, hw = 0.3, hl = 0.42;
  const sx = x1 + ux * 0.18, sy = y1 + uy * 0.18; // začátek kousek od středu pole
  const bx = x2 - ux * hl, by = y2 - uy * hl;
  const pts = [
    [sx + px * sw, sy + py * sw], [bx + px * sw, by + py * sw], [bx + px * hw, by + py * hw],
    [x2, y2],
    [bx - px * hw, by - py * hw], [bx - px * sw, by - py * sw], [sx - px * sw, sy - py * sw],
  ];
  return `<polygon class="${cls}" points="${pts.map((p) => p[0].toFixed(3) + ',' + p[1].toFixed(3)).join(' ')}"/>`;
}

// ---------- Vykreslení: hráči ----------
function capturedBy(side) {
  const out = [];
  for (let i = 0; i < pos.ply; i++) {
    const c = pos.uCaptured[i];
    if (c && (c >> 3) !== side) out.push(c);
  }
  return out.sort((a, b) => POINTS[b & 7] - POINTS[a & 7]);
}

function material(side) {
  let s = 0;
  for (let sq = 0; sq < 120; sq++) {
    if (sq & 0x88) { sq += 7; continue; }
    const p = pos.board[sq];
    if (p && (p >> 3) === side) s += POINTS[p & 7];
  }
  return s;
}

function renderPlayer(el, side) {
  const active = !isOver() && pos.turn === side;
  let name, sub;
  if (game.mode === 1) {
    if (side === game.human) { name = 'Ty'; sub = side === WHITE ? 'bílé figurky' : 'černé figurky'; }
    else { const lv = LEVELS[game.level] || LEVELS[1]; name = 'Počítač'; sub = `${lv.icon} ${lv.name}`; }
  } else {
    name = side === WHITE ? 'Bílý' : 'Černý';
    sub = 'hráč ' + (side === WHITE ? '1' : '2');
  }
  const caps = capturedBy(side).map((c) => pieceIcon(pieceKey(c))).join('');
  const adv = material(side) - material(side ^ 1);
  const thinking = aiThinking && game.mode === 1 && side !== game.human;
  el.className = 'player' + (active ? ' active' : '');
  el.innerHTML = `
    <div class="avatar ${side === WHITE ? 'w' : 'b'}">${pieceIcon(side === WHITE ? 'wK' : 'bK')}</div>
    <div class="pinfo">
      <div class="pname">${name} <span class="psub">${sub}</span></div>
      <div class="captured">${caps}${adv > 0 ? `<span class="adv">+${adv}</span>` : ''}</div>
    </div>
    ${thinking ? '<div class="thinking" aria-label="Počítač přemýšlí"><i></i><i></i><i></i></div>' : ''}
    ${active && !thinking ? '<div class="turn-pill">na tahu</div>' : ''}`;
}

// ---------- Vykreslení: informační panel ----------
function resultInfo() {
  const w = winner();
  const reason = game.resigned >= 0 ? 'resign' : status.reason;
  if (reason === 'checkmate' || reason === 'resign') {
    if (game.mode === 1) {
      return w === game.human
        ? { emoji: '🏆', title: 'Vyhrál jsi!', text: reason === 'checkmate' ? 'Dal jsi počítači mat. Skvělá partie!' : 'Počítač se vzdal.' }
        : { emoji: '😔', title: 'Prohra', text: reason === 'checkmate' ? 'Počítač ti dal mat. Zkus to znovu – třeba s nápovědou 💡 nebo na nižší úrovni.' : 'Partii jsi vzdal. Příště to vyjde!' };
    }
    const loser = SIDE_CS[w ^ 1];
    return { emoji: '🏆', title: `Vyhrál ${SIDE_CS[w]}!`, text: reason === 'checkmate' ? `Mat – ${SIDE_CS[w]} vyhrává partii.` : `${loser[0].toUpperCase() + loser.slice(1)} se vzdal.` };
  }
  const draws = {
    stalemate: 'Pat – hráč na tahu nemá žádný povolený tah, ale není v šachu.',
    material: 'Nedostatek materiálu – mat už nemůže dát nikdo.',
    repetition: 'Stejná pozice se na šachovnici objevila potřetí.',
    fifty: 'Padesát tahů nikdo nebral ani netáhl pěšcem.',
  };
  return { emoji: '🤝', title: reason === 'stalemate' ? 'Pat – remíza' : 'Remíza', text: draws[reason] || '' };
}

function statusText() {
  if (isOver()) return resultInfo().title;
  if (game.mode === 1) {
    if (aiThinking) return 'Počítač přemýšlí…';
    return status.check ? 'Jsi v šachu! Ochraň krále.' : 'Jsi na tahu';
  }
  return `Na tahu je ${SIDE_CS[pos.turn]}` + (status.check ? ' – šach!' : '');
}

function movesHtml() {
  if (!sans.length) return '<div class="moves-empty">Zatím žádné tahy. Bílý začíná.</div>';
  let html = '';
  for (let i = 0; i < sans.length; i += 2) {
    const cur = (j) => (j === sans.length - 1 ? ' cur' : '');
    html += `<span class="mv"><span class="mvn">${i / 2 + 1}.</span><span class="mvs${cur(i)}">${esc(sans[i])}</span>` +
      (sans[i + 1] ? `<span class="mvs${cur(i + 1)}">${esc(sans[i + 1])}</span>` : '') + '</span>';
  }
  return html;
}

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function installBanner() {
  if (isStandalone() || !isIOS()) return '';
  return `
    <div class="install-banner">
      <span class="emoji">📲</span>
      <p>Nainstaluj si Šachy na plochu: klepni na <b>Sdílet</b> a zvol <b>Přidat na plochu</b>. Pak poběží celoobrazovkově a <b>bez internetu</b>.</p>
    </div>`;
}

function renderInfo() {
  const over = isOver();
  let dotSide = pos.turn === WHITE ? 'w' : 'b';
  let sub = '';
  if (!over && game.mode === 1 && !aiThinking && sans.length && pos.turn === game.human) {
    sub = `Počítač zahrál <b>${esc(sans[sans.length - 1])}</b>.`;
  } else if (over) {
    sub = esc(resultInfo().text);
  } else if (!sans.length && canHumanMove()) {
    sub = 'Klepni na figurku a pak na pole, kam má táhnout. Nevíš? Zkus 💡 Nápovědu.';
  }

  const opening = Chess.openingName(game.moves);
  $('#info').innerHTML = `
    <div class="status ${over ? 'over' : ''} ${status.check && !over ? 'in-check' : ''}">
      <span class="turn-dot ${over ? 'none' : dotSide}"></span>
      <div class="status-text">
        <div class="st-main">${esc(statusText())}</div>
        ${sub ? `<div class="st-sub">${sub}</div>` : ''}
      </div>
      ${over ? '<button class="small-btn primary" data-action="open-new-game">Nová hra</button>' : ''}
    </div>
    <div class="moves-wrap">
      ${opening ? `<div class="opening">📖 ${esc(opening)}</div>` : ''}
      <div class="moves" id="moves">${movesHtml()}</div>
    </div>`;

  const mv = $('#moves');
  mv.scrollLeft = mv.scrollWidth;
}

// plovoucí karta nápovědy nad spodní lištou (překreslí se jen při změně)
let renderedHint = null;
function renderHint() {
  if (renderedHint === hint) return;
  renderedHint = hint;
  const el = $('#hint-panel');
  if (!hint) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  el.hidden = false;
  el.innerHTML = hint.loading
    ? '<div class="hint-card loading"><span class="spinner"></span>Hledám nejlepší tah…</div>'
    : `<div class="hint-card" role="status">
        <div class="hint-head">
          <span class="hint-icon">💡</span>
          ${pieceIcon(pieceKey(pos.board[moveFrom(hint.move)]))}
          <span class="hint-title">${esc(hint.title)}</span>
        </div>
        <ul class="hint-reasons">${hint.reasons.map((r) => `<li>${r}</li>`).join('')}</ul>
        <div class="hint-actions">
          <button class="small-btn primary" data-action="play-hint">Zahrát tah</button>
          <button class="small-btn" data-action="close-hint">Zkusím sám</button>
        </div>
      </div>`;
}

function renderToolbar() {
  $('#btn-undo').disabled = !undoCount();
  const hb = $('#btn-hint');
  hb.disabled = !canHumanMove();
  hb.classList.toggle('busy', !!(hint && hint.loading));
}

function render() {
  const flipped = isFlipped();
  renderPlayer($('#player-top'), flipped ? WHITE : BLACK);
  renderPlayer($('#player-bottom'), flipped ? BLACK : WHITE);
  renderBoard();
  renderInfo();
  renderHint();
  renderToolbar();
}

// ---------- Ovládání šachovnice: klepnutí i tažení ----------
const boardEl = $('#board');
let drag = null; // { sq, x, y, moved, wasSelected, id, ghost }

function squareAt(x, y) {
  const r = boardEl.getBoundingClientRect();
  const col = Math.floor(((x - r.left) / r.width) * 8);
  const row = Math.floor(((y - r.top) / r.height) * 8);
  if (col < 0 || col > 7 || row < 0 || row > 7) return -1;
  const flipped = isFlipped();
  const rank = flipped ? row : 7 - row;
  const file = flipped ? 7 - col : col;
  return rank * 16 + file;
}

function select(sq) {
  selected = sq;
  renderBoard();
}

boardEl.addEventListener('pointerdown', (e) => {
  if (e.button > 0) return;
  unlockAudio();
  const sq = squareAt(e.clientX, e.clientY);
  if (sq < 0 || !canHumanMove()) return;
  e.preventDefault();
  const p = pos.board[sq];
  const own = p && (p >> 3) === pos.turn;
  if (!own) {
    if (selected >= 0 && !tryMove(selected, sq, true)) select(-1);
    return;
  }
  const wasSelected = selected === sq;
  select(sq);
  drag = { sq, x: e.clientX, y: e.clientY, moved: false, wasSelected, id: e.pointerId, ghost: null };
  try { boardEl.setPointerCapture(e.pointerId); } catch { /* nevadí */ }
});

boardEl.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  if (!drag.moved) {
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 8) return;
    drag.moved = true;
    const src = boardEl.querySelector(`[data-sq="${drag.sq}"] .pc`);
    if (src) src.classList.add('lifted');
    const size = boardEl.getBoundingClientRect().width / 8;
    const g = document.createElement('div');
    g.className = `pc ghost ${pieceKey(pos.board[drag.sq])}`;
    g.style.width = g.style.height = size + 'px';
    document.body.appendChild(g);
    drag.ghost = g;
  }
  const g = drag.ghost;
  const size = parseFloat(g.style.width);
  // figurka nad prstem, aby byla vidět
  g.style.transform = `translate(${e.clientX - size / 2}px, ${e.clientY - size * 0.85}px) scale(1.25)`;
  const over = squareAt(e.clientX, e.clientY);
  boardEl.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
  if (over >= 0) {
    const el = boardEl.querySelector(`[data-sq="${over}"]`);
    if (el) el.classList.add('drag-over');
  }
});

function endDrag(e, cancel) {
  if (!drag || (e && e.pointerId !== drag.id)) return;
  const d = drag;
  drag = null;
  if (d.ghost) d.ghost.remove();
  if (d.moved) {
    const sq = cancel ? -1 : squareAt(e.clientX, e.clientY);
    if (sq >= 0 && sq !== d.sq && tryMove(d.sq, sq, false)) return;
    renderBoard();
  } else if (d.wasSelected) {
    select(-1);
  }
}

boardEl.addEventListener('pointerup', (e) => endDrag(e, false));
boardEl.addEventListener('pointercancel', (e) => endDrag(e, true));
boardEl.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- Bottom sheet ----------
function openSheet(html, onClose) {
  const backdrop = $('#sheet');
  $('#sheet-body').innerHTML = html;
  backdrop.onCloseSheet = onClose || null;
  backdrop.hidden = false;
  requestAnimationFrame(() => backdrop.classList.add('open'));
}

function closeSheet() {
  const backdrop = $('#sheet');
  if (backdrop.hidden) return;
  backdrop.classList.remove('open');
  const cb = backdrop.onCloseSheet;
  backdrop.onCloseSheet = null;
  setTimeout(() => { if (!backdrop.classList.contains('open')) backdrop.hidden = true; }, 300);
  if (cb) cb();
}

// proměna pěšce: výběr figurky
function askPromotion(cands, animate) {
  const color = pos.turn === WHITE ? 'w' : 'b';
  const order = [QUEEN, ROOK, BISHOP, KNIGHT];
  const buttons = order
    .map((t) => {
      const m = cands.find((c) => movePromo(c) === t);
      return `<button class="promo-btn" data-action="promote" data-move="${m}">
        <span class="pc-big pc ${color}${' PNBRQK'[t]}"></span><span>${PIECE_CS[t].nom[0].toUpperCase() + PIECE_CS[t].nom.slice(1)}</span></button>`;
    })
    .join('');
  openSheet(`<h3>Proměna pěšce</h3><p class="sheet-desc">Pěšec došel na konec šachovnice. V co se má proměnit?</p>
    <div class="promo-grid">${buttons}</div>`, () => { selected = -1; renderBoard(); });
  promoAnimate = animate;
}

function showGameOver() {
  if (!isOver() || game.endShown) return;
  game.endShown = true;
  saveGame();
  const r = resultInfo();
  openSheet(`
    <div class="result">
      <div class="result-emoji">${r.emoji}</div>
      <h3>${esc(r.title)}</h3>
      <p>${esc(r.text)}</p>
    </div>
    <button class="btn" data-action="open-new-game">Nová hra</button>
    ${undoCount() ? '<button class="btn secondary" data-action="undo">Vrátit tah</button>' : ''}
    <button class="btn ghost" data-action="close-sheet">Prohlédnout pozici</button>`);
}

function openNewGame() {
  if (!newGameDraft) newGameDraft = { mode: game.mode, color: String(game.human), level: game.level };
  const d = newGameDraft;
  const seg = (group, items) =>
    `<div class="segmented" role="group">${items
      .map(([val, label]) => `<button data-action="draft" data-group="${group}" data-val="${val}" class="${String(d[group]) === String(val) ? 'active' : ''}">${label}</button>`)
      .join('')}</div>`;
  const levels = LEVELS.map((lv, i) => `
    <button class="level-row ${d.level === i ? 'active' : ''}" data-action="draft" data-group="level" data-val="${i}">
      <span class="lv-icon">${lv.icon}</span>
      <span class="lv-text"><b>${lv.name}</b><small>${lv.desc}</small></span>
      <span class="lv-check">✓</span>
    </button>`).join('');
  openSheet(`
    <h3>Nová hra</h3>
    <div class="form-row">
      <label>Kdo hraje</label>
      ${seg('mode', [[1, '🤖 Proti počítači'], [2, '👥 Dva hráči']])}
    </div>
    ${d.mode === 1 ? `
      <div class="form-row">
        <label>Hraješ za</label>
        ${seg('color', [[WHITE, `${pieceIcon('wK')} Bílé`], [BLACK, `${pieceIcon('bK')} Černé`], ['r', '🎲 Náhodně']])}
      </div>
      <div class="form-row">
        <label>Obtížnost</label>
        <div class="levels">${levels}</div>
      </div>` : `
      <p class="sheet-desc">Hrajete na jednom telefonu a po každém tahu si ho předáte. Bílý začíná.
      V Možnostech můžete zapnout otáčení šachovnice podle hráče na tahu.</p>`}
    <button class="btn" data-action="start-game">Začít hru</button>
    ${installBanner()}`);
}

function openOptions() {
  const sw = (key, label, desc) => `
    <label class="settings-row">
      <span>${label}${desc ? `<span class="desc">${desc}</span>` : ''}</span>
      <span class="switch"><input type="checkbox" data-setting="${key}" ${settings[key] ? 'checked' : ''}><span></span></span>
    </label>`;
  const themes = BOARD_THEMES.map(([k, label]) =>
    `<button class="theme-chip ${settings.theme === k ? 'active' : ''}" data-action="theme" data-val="${k}">
      <span class="theme-swatch" data-board="${k}"><i></i><i></i><i></i><i></i></span>${label}</button>`).join('');
  openSheet(`
    <h3>Možnosti</h3>
    ${installBanner()}
    <button class="sheet-list-item" data-action="flip"><span class="li-icon">🔄</span><span class="name">Otočit šachovnici</span></button>
    <div class="settings-group">
      ${sw('showMoves', 'Ukazovat možné tahy', 'Tečky po klepnutí na figurku')}
      ${sw('coords', 'Souřadnice', 'Písmena a čísla na okraji šachovnice')}
      ${sw('sound', 'Zvuky')}
      ${sw('autoFlip', 'Otáčet šachovnici (2 hráči)', 'Hráč na tahu má své figurky dole')}
    </div>
    <div class="form-row">
      <label>Barva šachovnice</label>
      <div class="themes">${themes}</div>
    </div>
    ${!isOver() && game.moves.length ? '<button class="btn destructive" data-action="resign">🏳️ Vzdát partii</button>' : ''}
    <p class="about">Šachy · funguje bez internetu · figurky: Colin M. L. Burnett (GPL/BSD)</p>`);
}

// ---------- Pravidla ----------
// diagram pro výklad pravidel (SVG)
function board(fen, opts = {}) {
  const list = (s) => (s ? s.split(' ').filter(Boolean).map(sqFromName) : []);
  const xy = (sq) => [sq & 7, 7 - (sq >> 4)];
  const rows = fen.split(' ')[0].split('/');
  let svg = `<figure class="diagram"><svg viewBox="0 0 8 8" role="img" aria-label="${esc(opts.label || 'Diagram')}">`;
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      svg += `<rect x="${f}" y="${7 - r}" width="1" height="1" class="${(r + f) % 2 ? 'dl' : 'dd'}"/>`;
    }
  }
  for (const sq of list(opts.check)) {
    const [x, y] = xy(sq);
    svg += `<rect x="${x}" y="${y}" width="1" height="1" class="dcheck"/>`;
  }
  rows.forEach((row, i) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) { f += Number(ch); continue; }
      const key = (ch === ch.toUpperCase() ? 'w' : 'b') + ch.toUpperCase();
      svg += `<g transform="translate(${f} ${i}) scale(${1 / 45})">${PIECE_SVG[key]}</g>`;
      f++;
    }
  });
  for (const sq of list(opts.dots)) {
    const [x, y] = xy(sq);
    svg += `<circle cx="${x + 0.5}" cy="${y + 0.5}" r="0.15" class="ddot"/>`;
  }
  for (const sq of list(opts.rings)) {
    const [x, y] = xy(sq);
    svg += `<circle cx="${x + 0.5}" cy="${y + 0.5}" r="0.44" class="dring"/>`;
  }
  for (const sq of list(opts.cross)) {
    const [x, y] = xy(sq);
    svg += `<path d="M${x + 0.3} ${y + 0.3}l0.4 0.4m0-0.4l-0.4 0.4" class="dcross"/>`;
  }
  for (const a of (opts.arrows || '').split(' ').filter(Boolean)) {
    const [from, to] = a.split('-').map(sqFromName);
    const [x1, y1] = xy(from), [x2, y2] = xy(to);
    svg += arrowSvg(x1 + 0.5, y1 + 0.5, x2 + 0.5, y2 + 0.5, 'darrow');
  }
  for (let i = 0; i < 8; i++) {
    svg += `<text x="${i + 0.96}" y="7.94" class="dcoord ${i % 2 ? 'on-d' : 'on-l'}" text-anchor="end">${'abcdefgh'[i]}</text>`;
    svg += `<text x="0.05" y="${7 - i + 0.25}" class="dcoord ${i % 2 ? 'on-d' : 'on-l'}">${i + 1}</text>`;
  }
  svg += '</svg>';
  if (opts.label) svg += `<figcaption>${esc(opts.label)}</figcaption>`;
  return svg + '</figure>';
}

function openRules(sectionId) {
  const page = $('#rules');
  const body = $('#rules-body');
  if (!body.dataset.ready) {
    body.innerHTML = rulesHtml(board);
    $('#rules-toc').innerHTML = RULES_TOC.map(([id, label]) => `<button class="chip" data-action="rules-goto" data-id="${id}">${label}</button>`).join('');
    body.dataset.ready = '1';
  }
  page.hidden = false;
  requestAnimationFrame(() => page.classList.add('open'));
  if (sectionId) rulesGoto(sectionId);
}

function rulesGoto(id) {
  const el = document.getElementById(id);
  if (el) $('#rules-body').scrollTo({ top: el.offsetTop - 8, behavior: 'smooth' });
}

function closeRules() {
  const page = $('#rules');
  page.classList.remove('open');
  setTimeout(() => { if (!page.classList.contains('open')) page.hidden = true; }, 320);
}

// ---------- Události ----------
document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el) {
    if (ev.target.id === 'sheet') closeSheet();
    return;
  }
  if (el.disabled) return;
  const a = el.dataset.action;
  switch (a) {
    case 'open-new-game':
      newGameDraft = null;
      openNewGame();
      break;
    case 'draft': {
      const v = el.dataset.val;
      const g = el.dataset.group;
      newGameDraft[g] = g === 'color' ? v : Number(v);
      openNewGame();
      break;
    }
    case 'start-game':
      closeSheet();
      newGame(newGameDraft);
      break;
    case 'undo': undo(); break;
    case 'hint': requestHint(); break;
    case 'play-hint': playHint(); break;
    case 'close-hint': hint = null; hintToken++; render(); break;
    case 'open-rules': openRules(); break;
    case 'close-rules': closeRules(); break;
    case 'rules-goto': rulesGoto(el.dataset.id); break;
    case 'open-options': openOptions(); break;
    case 'flip':
      game.flip = !game.flip;
      saveGame();
      closeSheet();
      render();
      break;
    case 'theme':
      settings.theme = el.dataset.val;
      saveSettings();
      openOptions();
      render();
      break;
    case 'resign': resign(); break;
    case 'promote': {
      const m = Number(el.dataset.move);
      const backdrop = $('#sheet');
      backdrop.onCloseSheet = null;
      closeSheet();
      if (canHumanMove() && status.moves.includes(m)) applyMove(m, promoAnimate);
      break;
    }
    case 'close-sheet': closeSheet(); break;
  }
});

document.addEventListener('change', (ev) => {
  const key = ev.target.dataset && ev.target.dataset.setting;
  if (!key) return;
  settings[key] = ev.target.checked;
  saveSettings();
  if (key === 'sound' && settings.sound) unlockAudio();
  render();
});

// ---------- Start ----------
loadGame();
render();
if (game.mode === 1 && !isOver() && pos.turn !== game.human) scheduleAi();
// první spuštění: nabídni výběr hry
if (!store.get('game', null)) {
  saveGame();
  setTimeout(() => {
    newGameDraft = null;
    openNewGame();
  }, 250);
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline režim nedostupný */ });
  });
}
