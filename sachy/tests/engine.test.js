'use strict';

/* Testy enginu: perft (počty tahů ve známých pozicích), notace,
   konec hry, taktika AI a platnost knihovny zahájení.
   Spuštění: node sachy/tests/engine.test.js  (FULL=1 pro hlubší perft) */

const assert = require('assert');
const Chess = require('../engine.js');

const { Position, Searcher } = Chess;
let failed = 0, passed = 0;

function test(name, fn) {
  const t0 = Date.now();
  try {
    fn();
    passed++;
    console.log(`✓ ${name} (${Date.now() - t0} ms)`);
  } catch (e) {
    failed++;
    console.log(`✗ ${name}\n  ${e.message}`);
  }
}

const play = (pos, ucis) => {
  for (const u of ucis.split(' ').filter(Boolean)) {
    const m = pos.moveFromUci(u);
    assert.ok(m, `neplatný tah ${u} v pozici ${pos.fen()}`);
    pos.makeMove(m);
  }
  return pos;
};

// ---------- Perft ----------
// https://www.chessprogramming.org/Perft_Results
const FULL = !!process.env.FULL;
const PERFT = [
  ['výchozí postavení', Chess.START_FEN, [20, 400, 8902, 197281, FULL && 4865609]],
  ['Kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862, FULL && 4085603]],
  ['pozice 3 (mimochodem, vazby)', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238, 674624]],
  ['pozice 4 (proměny, rošády)', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467, 422333]],
  ['pozice 4 zrcadlově', 'r2q1rk1/pP1p2pp/Q4n2/bbp1p3/Np6/1B3NBn/pPPP1PPP/R3K2R b KQ - 0 1', [6, 264, 9467, 422333]],
  ['pozice 5', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379, FULL && 2103487]],
  ['pozice 6', 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10', [46, 2079, 89890]],
];

for (const [name, fen, counts] of PERFT) {
  test(`perft: ${name}`, () => {
    const pos = new Position(fen);
    counts.forEach((expected, i) => {
      if (!expected) return;
      const n = pos.perft(i + 1);
      assert.strictEqual(n, expected, `hloubka ${i + 1}: ${n} ≠ ${expected}`);
    });
    assert.strictEqual(pos.fen().split(' ').slice(0, 4).join(' '), new Position(fen).fen().split(' ').slice(0, 4).join(' '), 'po perftu se pozice nevrátila');
  });
}

// ---------- FEN, hash, vracení tahů ----------
test('FEN tam a zpět', () => {
  for (const [, fen] of PERFT) assert.strictEqual(new Position(fen).fen(), fen);
});

test('hash po tazích a vrácení odpovídá', () => {
  const pos = play(new Position(), 'e2e4 d7d5 e4d5 g8f6 f1b5 c7c6 d5c6 d8a5 c6b7 a5b5 b7a8q');
  const fresh = new Position(pos.fen());
  assert.strictEqual(pos.hashLo, fresh.hashLo);
  assert.strictEqual(pos.hashHi, fresh.hashHi);
  while (pos.ply) pos.unmakeMove();
  assert.strictEqual(pos.fen(), Chess.START_FEN);
  assert.strictEqual(pos.hashLo, new Position().hashLo);
});

// ---------- Notace ----------
test('česká notace (SAN)', () => {
  const pos = new Position();
  const sans = [];
  for (const u of 'e2e4 e7e5 g1f3 b8c6 f1c4 g8f6 e1g1 f8c5 d2d3 d7d6 c1g5 h7h6 g5f6 d8f6'.split(' ')) {
    const m = pos.moveFromUci(u);
    sans.push(pos.san(m));
    pos.makeMove(m);
  }
  assert.strictEqual(sans.join(' '), 'e4 e5 Jf3 Jc6 Sc4 Jf6 O-O Sc5 d3 d6 Sg5 h6 Sxf6 Dxf6');
  // rozlišení jezdců, mat
  const p2 = new Position('7k/8/8/8/8/8/6PP/R3R2K w - - 0 1');
  assert.strictEqual(p2.san(p2.moveFromUci('a1d1')), 'Vad1');
  const p3 = new Position('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1');
  assert.strictEqual(p3.san(p3.moveFromUci('a1a8')), 'Va8#');
  const p4 = new Position('8/4P1k1/8/8/8/8/8/4K3 w - - 0 1');
  assert.strictEqual(p4.san(p4.moveFromUci('e7e8q')), 'e8=D');
  assert.strictEqual(p4.san(p4.moveFromUci('e7e8n'), Chess.LETTERS_EN), 'e8=N+'); // jezdec z e8 napadá g7
});

// ---------- Konec hry ----------
test('mat, pat a remízy', () => {
  const mate = play(new Position(), 'f2f3 e7e5 g2g4 d8h4');
  assert.deepStrictEqual([mate.status().reason, mate.status().winner], ['checkmate', Chess.BLACK]);

  const stale = new Position('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  assert.strictEqual(stale.status().reason, 'stalemate');

  assert.strictEqual(new Position('8/8/4k3/8/8/2B5/4K3/8 w - - 0 1').status().reason, 'material');
  assert.strictEqual(new Position('8/8/4k3/8/8/2N5/4K3/8 w - - 0 1').status().reason, 'material');
  assert.strictEqual(new Position('8/2b5/4k3/8/8/2B5/4K3/8 w - - 0 1').status().reason, 'material'); // střelci na stejné barvě
  assert.strictEqual(new Position('8/3b4/4k3/8/8/2B5/4K3/8 w - - 0 1').status().over, false); // na různé barvě
  assert.strictEqual(new Position('8/8/4k3/8/8/2NN4/4K3/8 w - - 0 1').status().over, false);

  const rep = play(new Position(), 'g1f3 g8f6 f3g1 f6g8 g1f3 g8f6 f3g1 f6g8');
  assert.strictEqual(rep.status().reason, 'repetition');

  assert.strictEqual(new Position('8/8/4k3/8/8/8/4K3/7R w - - 100 80').status().reason, 'fifty');
});

test('rošáda je zakázaná přes napadené pole a v šachu', () => {
  const through = new Position('r3k2r/8/8/8/8/7q/8/R3K2R w KQkq - 0 1');
  const ucis = through.legalMoves().map(Chess.moveToUci);
  assert.ok(!ucis.includes('e1g1'), 'malá rošáda přes napadené f1');
  assert.ok(ucis.includes('e1c1'), 'velká rošáda má být povolená');
  const check = new Position('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  assert.ok(check.legalMoves().map(Chess.moveToUci).includes('e1g1'));
  const inCheck = new Position('r3k2r/8/8/8/4q3/8/8/R3K2R w KQkq - 0 1');
  assert.ok(!inCheck.legalMoves().map(Chess.moveToUci).some((u) => u === 'e1g1' || u === 'e1c1'));
});

test('braní mimochodem jen hned po dvojkroku', () => {
  const pos = play(new Position(), 'e2e4 a7a6 e4e5 d7d5');
  assert.ok(pos.moveFromUci('e5d6'), 'mimochodem má jít');
  play(pos, 'a2a3 a6a5');
  assert.ok(!pos.moveFromUci('e5d6'), 'o tah později už ne');
});

// ---------- Umělá inteligence ----------
const best = (fen, opts) => {
  const r = new Searcher().think(new Position(fen), Object.assign({ maxDepth: 6, timeMs: 3000 }, opts));
  return { uci: Chess.moveToUci(r.move), ...r };
};

test('AI najde mat jedním tahem', () => {
  assert.strictEqual(best('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1').uci, 'a1a8');
  assert.strictEqual(best('r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 4 4').uci, 'f3f7');
});

test('AI najde mat dvěma tahy', () => {
  // dámská oběť: 1. Dd8+ Vxd8 2. Vxd8#
  const r = best('3r2k1/5ppp/8/8/8/8/3Q1PPP/3R2K1 w - - 0 1');
  assert.ok(r.score > Chess.MATE_BOUND, `skóre ${r.score}`);
});

test('AI sebere visící dámu a nenechá svou', () => {
  assert.strictEqual(best('rnb1kbnr/pppp1ppp/8/4p1q1/3P4/8/PPP1PPPP/RNBQKBNR w KQkq - 0 3').uci, 'c1g5');
  const r = best('rnbqkbnr/pppp1ppp/8/4p3/4P1Q1/8/PPPP1PPP/RNB1KBNR b KQkq - 1 2');
  const pos = new Position('rnbqkbnr/pppp1ppp/8/4p3/4P1Q1/8/PPPP1PPP/RNB1KBNR b KQkq - 1 2');
  pos.makeMove(pos.moveFromUci(r.uci));
  assert.ok(pos.evaluate() > -300, 'černý po tahu nemá prohrávat materiál');
});

test('AI dá mat dámou v koncovce K+D vs K', () => {
  const pos = new Position('8/8/8/4k3/8/8/8/3QK3 w - - 0 1');
  const s = new Searcher();
  for (let i = 0; i < 60 && !pos.status().over; i++) {
    const r = s.think(pos, { maxDepth: 8, timeMs: 400 });
    pos.makeMove(r.move);
  }
  assert.strictEqual(pos.status().reason, 'checkmate', `konec: ${pos.status().reason} ${pos.fen()}`);
});

test('úrovně: začátečník se šumem odpovídá rychle a legálně', () => {
  const pos = new Position();
  const s = new Searcher();
  for (let i = 0; i < 20 && !pos.status().over; i++) {
    const t0 = Date.now();
    const r = s.think(pos, { maxDepth: 1, timeMs: 400, noise: 220 });
    assert.ok(Date.now() - t0 < 1500, 'trvalo příliš dlouho');
    assert.ok(pos.legalMoves().includes(r.move));
    pos.makeMove(r.move);
  }
});

test('rychlost: mistr dodrží časový limit', () => {
  const pos = new Position('r1bq1rk1/pp2bppp/2n1pn2/3p4/2PP4/2N1PN2/PP3PPP/R2QKB1R w KQ - 0 8');
  const t0 = Date.now();
  const r = new Searcher().think(pos, { maxDepth: 30, timeMs: 1500 });
  const ms = Date.now() - t0;
  console.log(`    hloubka ${r.depth}, ${r.nodes} uzlů, ${ms} ms`);
  assert.ok(ms < 2500, `${ms} ms`);
  assert.ok(r.depth >= 4, `hloubka jen ${r.depth}`);
});

// ---------- Knihovna zahájení ----------
test('všechny řady v knihovně zahájení jsou legální', () => {
  for (const o of Chess.OPENINGS) play(new Position(), o.moves.join(' '));
  assert.strictEqual(Chess.openingName('e2e4 e7e5 g1f3 b8c6 f1c4 f8c5'.split(' ')), 'Italská hra');
  assert.strictEqual(Chess.openingName('e2e4 e7e5 g1f3 b8c6'.split(' ')), null);
  assert.strictEqual(Chess.openingName('e2e4 c7c5 g1f3'.split(' ')), 'Sicilská obrana');
  assert.ok(['e7e5', 'c7c5', 'e7e6', 'c7c6', 'd7d5', 'd7d6'].includes(Chess.bookMove(['e2e4'])));
  assert.strictEqual(Chess.bookMove(['a2a3']), null);
});

console.log(`\n${passed} prošlo, ${failed} selhalo`);
process.exit(failed ? 1 : 0);
