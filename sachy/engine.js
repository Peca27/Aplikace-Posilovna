'use strict';

/* =====================================================
   Šachy — engine: pravidla hry + umělá inteligence
   Běží v hlavním vlákně (pravidla, nápověda), ve Web Workeru
   (hledání tahu počítače) i v Node.js (testy). Bez závislostí.
   Šachovnice 0x88: pole = řada * 16 + sloupec (a1 = 0, h8 = 119).
   ===================================================== */

(function (global) {
  // ---------- Konstanty ----------
  const WHITE = 0;
  const BLACK = 1;
  const PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;
  // kód figury = typ | barva << 3 → bílé 1–6, černé 9–14
  const W_PAWN = 1, W_ROOK = 4, W_KING = 6;
  const B_PAWN = 9, B_ROOK = 12, B_KING = 14;

  const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  // příznaky tahu
  const F_CAPTURE = 1, F_DOUBLE = 2, F_EP = 4, F_CASTLE = 8;

  const KNIGHT_DIRS = [33, 31, 18, 14, -14, -18, -31, -33];
  const BISHOP_DIRS = [17, 15, -15, -17];
  const ROOK_DIRS = [16, 1, -1, -16];
  const KING_DIRS = [17, 16, 15, 1, -1, -15, -16, -17];

  // tah = odkud | kam << 7 | proměna << 14 | příznaky << 17
  const encodeMove = (from, to, promo, flags) => from | (to << 7) | (promo << 14) | (flags << 17);
  const moveFrom = (m) => m & 127;
  const moveTo = (m) => (m >> 7) & 127;
  const movePromo = (m) => (m >> 14) & 7;
  const moveFlags = (m) => m >> 17;

  const sqName = (sq) => 'abcdefgh'[sq & 7] + ((sq >> 4) + 1);
  const sqFromName = (name) => (name.charCodeAt(1) - 49) * 16 + (name.charCodeAt(0) - 97);
  const moveToUci = (m) => sqName(moveFrom(m)) + sqName(moveTo(m)) + (movePromo(m) ? '  nbrq'[movePromo(m)] : '');

  // písmena figur v notaci (index = typ figury)
  const LETTERS_CS = ['', '', 'J', 'S', 'V', 'D', 'K'];
  const LETTERS_EN = ['', '', 'N', 'B', 'R', 'Q', 'K'];

  // práva na rošádu: 1 = bílá malá, 2 = bílá velká, 4 = černá malá, 8 = černá velká
  const CASTLE_MASK = new Uint8Array(128).fill(15);
  CASTLE_MASK[0] = 13;
  CASTLE_MASK[4] = 12;
  CASTLE_MASK[7] = 14;
  CASTLE_MASK[112] = 7;
  CASTLE_MASK[116] = 3;
  CASTLE_MASK[119] = 11;

  // ---------- Zobristovo hashování (dvě 32bitové půlky) ----------
  let seed = 0x2545f491;
  const rand32 = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return seed | 0;
  };
  const Z_PIECE_LO = new Int32Array(16 * 128), Z_PIECE_HI = new Int32Array(16 * 128);
  for (let i = 0; i < 16 * 128; i++) { Z_PIECE_LO[i] = rand32(); Z_PIECE_HI[i] = rand32(); }
  const Z_CASTLE_LO = new Int32Array(16), Z_CASTLE_HI = new Int32Array(16);
  for (let i = 0; i < 16; i++) { Z_CASTLE_LO[i] = rand32(); Z_CASTLE_HI[i] = rand32(); }
  const Z_EP_LO = new Int32Array(8), Z_EP_HI = new Int32Array(8);
  for (let i = 0; i < 8; i++) { Z_EP_LO[i] = rand32(); Z_EP_HI[i] = rand32(); }
  const Z_SIDE_LO = rand32(), Z_SIDE_HI = rand32();

  // ---------- Hodnocení pozice ----------
  const PIECE_VALUE = [0, 100, 320, 330, 500, 900, 0];
  const PHASE = [0, 0, 1, 1, 2, 4, 0];

  // tabulky pozic z pohledu bílého, první řádek = 8. řada
  const T_PAWN_MG = [
    0, 0, 0, 0, 0, 0, 0, 0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
    5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0,
    5, -5, -10, 0, 0, -10, -5, 5,
    5, 10, 10, -20, -20, 10, 10, 5,
    0, 0, 0, 0, 0, 0, 0, 0,
  ];
  const T_PAWN_EG = [
    0, 0, 0, 0, 0, 0, 0, 0,
    80, 80, 80, 80, 80, 80, 80, 80,
    50, 50, 50, 50, 50, 50, 50, 50,
    30, 30, 30, 30, 30, 30, 30, 30,
    20, 20, 20, 20, 20, 20, 20, 20,
    10, 10, 10, 10, 10, 10, 10, 10,
    0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0,
  ];
  const T_KNIGHT = [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20, 0, 0, 0, 0, -20, -40,
    -30, 0, 10, 15, 15, 10, 0, -30,
    -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30,
    -30, 5, 10, 15, 15, 10, 5, -30,
    -40, -20, 0, 5, 5, 0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50,
  ];
  const T_BISHOP = [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 10, 10, 5, 0, -10,
    -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10,
    -10, 10, 10, 10, 10, 10, 10, -10,
    -10, 5, 0, 0, 0, 0, 5, -10,
    -20, -10, -10, -10, -10, -10, -10, -20,
  ];
  const T_ROOK = [
    0, 0, 0, 0, 0, 0, 0, 0,
    5, 10, 10, 10, 10, 10, 10, 5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    0, 0, 0, 5, 5, 0, 0, 0,
  ];
  const T_QUEEN = [
    -20, -10, -10, -5, -5, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 5, 5, 5, 0, -10,
    -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5,
    -10, 5, 5, 5, 5, 5, 0, -10,
    -10, 0, 5, 0, 0, 0, 0, -10,
    -20, -10, -10, -5, -5, -10, -10, -20,
  ];
  const T_KING_MG = [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
    20, 20, 0, 0, 0, 0, 20, 20,
    20, 30, 10, 0, 0, 10, 30, 20,
  ];
  const T_KING_EG = [
    -50, -40, -30, -20, -20, -30, -40, -50,
    -30, -20, -10, 0, 0, -10, -20, -30,
    -30, -10, 20, 30, 30, 20, -10, -30,
    -30, -10, 30, 40, 40, 30, -10, -30,
    -30, -10, 30, 40, 40, 30, -10, -30,
    -30, -10, 20, 30, 30, 20, -10, -30,
    -30, -30, 0, 0, 0, 0, -30, -30,
    -50, -30, -30, -30, -30, -30, -30, -50,
  ];
  const TABLES_MG = [null, T_PAWN_MG, T_KNIGHT, T_BISHOP, T_ROOK, T_QUEEN, T_KING_MG];
  const TABLES_EG = [null, T_PAWN_EG, T_KNIGHT, T_BISHOP, T_ROOK, T_QUEEN, T_KING_EG];

  // předpočítané hodnoty materiál + pozice: [typ][barva * 128 + pole]
  const PST_MG = [null], PST_EG = [null];
  for (let t = 1; t <= 6; t++) {
    const mg = new Int16Array(256), eg = new Int16Array(256);
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const sq = r * 16 + f;
        const iw = (7 - r) * 8 + f; // bílý
        const ib = r * 8 + f; // černý (zrcadlově)
        mg[sq] = PIECE_VALUE[t] + TABLES_MG[t][iw];
        eg[sq] = PIECE_VALUE[t] + TABLES_EG[t][iw];
        mg[128 + sq] = PIECE_VALUE[t] + TABLES_MG[t][ib];
        eg[128 + sq] = PIECE_VALUE[t] + TABLES_EG[t][ib];
      }
    }
    PST_MG.push(mg);
    PST_EG.push(eg);
  }

  // bonus za volného pěšce podle řady (z pohledu jeho strany)
  const PASSED_MG = [0, 5, 5, 10, 20, 35, 60, 0];
  const PASSED_EG = [0, 10, 15, 25, 45, 75, 120, 0];

  // vzdálenost pole od středu (0–6), pro koncovky
  const centerDist = (sq) => {
    const f = sq & 7, r = sq >> 4;
    return (f < 4 ? 3 - f : f - 4) + (r < 4 ? 3 - r : r - 4);
  };
  const kingDist = (a, b) => Math.abs((a & 7) - (b & 7)) + Math.abs((a >> 4) - (b >> 4));

  // ---------- Pozice ----------
  class Position {
    constructor(fen) {
      this.board = new Int8Array(128);
      this.kings = [-1, -1];
      // zásobník pro vracení tahů
      this.uMove = [];
      this.uCaptured = [];
      this.uCastling = [];
      this.uEp = [];
      this.uHalf = [];
      this.uHashLo = [];
      this.uHashHi = [];
      // pracovní pole pro hodnocení
      this.evPawns = new Int8Array(40);
      this.evFiles = new Int8Array(32);
      this.load(fen || START_FEN);
    }

    load(fen) {
      const parts = String(fen).trim().split(/\s+/);
      const rows = (parts[0] || '').split('/');
      if (rows.length !== 8) throw new Error('Neplatná FEN');
      const b = this.board;
      b.fill(0);
      this.kings = [-1, -1];
      for (let i = 0; i < 8; i++) {
        const r = 7 - i;
        let f = 0;
        for (const ch of rows[i]) {
          if (ch >= '1' && ch <= '8') { f += ch.charCodeAt(0) - 48; continue; }
          const t = ' pnbrqk'.indexOf(ch.toLowerCase());
          if (t < 1 || f > 7) throw new Error('Neplatná FEN');
          const color = ch === ch.toLowerCase() ? BLACK : WHITE;
          if (t === PAWN && (r === 0 || r === 7)) throw new Error('Neplatná FEN');
          b[r * 16 + f] = t | (color << 3);
          if (t === KING) this.kings[color] = r * 16 + f;
          f++;
        }
      }
      if (this.kings[WHITE] < 0 || this.kings[BLACK] < 0) throw new Error('Chybí král');
      this.turn = parts[1] === 'b' ? BLACK : WHITE;
      const c = parts[2] || '-';
      this.castling = 0;
      if (c.includes('K') && b[4] === W_KING && b[7] === W_ROOK) this.castling |= 1;
      if (c.includes('Q') && b[4] === W_KING && b[0] === W_ROOK) this.castling |= 2;
      if (c.includes('k') && b[116] === B_KING && b[119] === B_ROOK) this.castling |= 4;
      if (c.includes('q') && b[116] === B_KING && b[112] === B_ROOK) this.castling |= 8;
      this.ep = -1;
      if (parts[3] && /^[a-h][36]$/.test(parts[3])) {
        const ep = sqFromName(parts[3]);
        if (this.epCapturable(ep, this.turn)) this.ep = ep;
      }
      this.halfmove = parseInt(parts[4], 10) || 0;
      this.fullmove = parseInt(parts[5], 10) || 1;
      this.ply = 0;
      this.computeHash();
    }

    // může strana `side` brát mimochodem na poli `ep`?
    epCapturable(ep, side) {
      const pawn = side === WHITE ? W_PAWN : B_PAWN;
      const from = ep + (side === WHITE ? -16 : 16);
      return (!((from - 1) & 0x88) && this.board[from - 1] === pawn) ||
        (!((from + 1) & 0x88) && this.board[from + 1] === pawn);
    }

    computeHash() {
      let lo = 0, hi = 0;
      for (let sq = 0; sq < 120; sq++) {
        if (sq & 0x88) { sq += 7; continue; }
        const p = this.board[sq];
        if (p) { lo ^= Z_PIECE_LO[p * 128 + sq]; hi ^= Z_PIECE_HI[p * 128 + sq]; }
      }
      lo ^= Z_CASTLE_LO[this.castling];
      hi ^= Z_CASTLE_HI[this.castling];
      if (this.ep >= 0) { lo ^= Z_EP_LO[this.ep & 7]; hi ^= Z_EP_HI[this.ep & 7]; }
      if (this.turn === BLACK) { lo ^= Z_SIDE_LO; hi ^= Z_SIDE_HI; }
      this.hashLo = lo;
      this.hashHi = hi;
    }

    fen() {
      let s = '';
      for (let r = 7; r >= 0; r--) {
        let empty = 0;
        for (let f = 0; f < 8; f++) {
          const p = this.board[r * 16 + f];
          if (!p) { empty++; continue; }
          if (empty) { s += empty; empty = 0; }
          const ch = ' pnbrqk'[p & 7];
          s += p < 8 ? ch.toUpperCase() : ch;
        }
        if (empty) s += empty;
        if (r) s += '/';
      }
      let cs = '';
      if (this.castling & 1) cs += 'K';
      if (this.castling & 2) cs += 'Q';
      if (this.castling & 4) cs += 'k';
      if (this.castling & 8) cs += 'q';
      return `${s} ${this.turn === WHITE ? 'w' : 'b'} ${cs || '-'} ${this.ep >= 0 ? sqName(this.ep) : '-'} ${this.halfmove} ${this.fullmove}`;
    }

    // ---------- Provedení a vrácení tahu ----------
    makeMove(m) {
      const b = this.board;
      const from = m & 127, to = (m >> 7) & 127, promo = (m >> 14) & 7, flags = m >> 17;
      const piece = b[from];
      const us = this.turn, them = us ^ 1;
      let captured = b[to];

      const p = this.ply++;
      this.uMove[p] = m;
      this.uCastling[p] = this.castling;
      this.uEp[p] = this.ep;
      this.uHalf[p] = this.halfmove;
      this.uHashLo[p] = this.hashLo;
      this.uHashHi[p] = this.hashHi;

      let lo = this.hashLo ^ Z_CASTLE_LO[this.castling] ^ Z_SIDE_LO;
      let hi = this.hashHi ^ Z_CASTLE_HI[this.castling] ^ Z_SIDE_HI;
      if (this.ep >= 0) { lo ^= Z_EP_LO[this.ep & 7]; hi ^= Z_EP_HI[this.ep & 7]; }

      b[from] = 0;
      lo ^= Z_PIECE_LO[piece * 128 + from];
      hi ^= Z_PIECE_HI[piece * 128 + from];

      if (flags & F_EP) {
        const capSq = to + (us === WHITE ? -16 : 16);
        captured = b[capSq];
        b[capSq] = 0;
        lo ^= Z_PIECE_LO[captured * 128 + capSq];
        hi ^= Z_PIECE_HI[captured * 128 + capSq];
      } else if (captured) {
        lo ^= Z_PIECE_LO[captured * 128 + to];
        hi ^= Z_PIECE_HI[captured * 128 + to];
      }
      this.uCaptured[p] = captured;

      const placed = promo ? promo | (us << 3) : piece;
      b[to] = placed;
      lo ^= Z_PIECE_LO[placed * 128 + to];
      hi ^= Z_PIECE_HI[placed * 128 + to];

      if (flags & F_CASTLE) {
        const rf = to > from ? from + 3 : from - 4;
        const rt = to > from ? from + 1 : from - 1;
        const rook = b[rf];
        b[rf] = 0;
        b[rt] = rook;
        lo ^= Z_PIECE_LO[rook * 128 + rf] ^ Z_PIECE_LO[rook * 128 + rt];
        hi ^= Z_PIECE_HI[rook * 128 + rf] ^ Z_PIECE_HI[rook * 128 + rt];
      }
      if ((piece & 7) === KING) this.kings[us] = to;

      this.castling &= CASTLE_MASK[from] & CASTLE_MASK[to];
      lo ^= Z_CASTLE_LO[this.castling];
      hi ^= Z_CASTLE_HI[this.castling];

      this.ep = -1;
      if (flags & F_DOUBLE) {
        const ep = (from + to) >> 1;
        // pole mimochodem jen tehdy, když ho soupeř může využít
        if (this.epCapturable(ep, them)) {
          this.ep = ep;
          lo ^= Z_EP_LO[ep & 7];
          hi ^= Z_EP_HI[ep & 7];
        }
      }

      this.halfmove = (piece & 7) === PAWN || captured ? 0 : this.halfmove + 1;
      if (us === BLACK) this.fullmove++;
      this.turn = them;
      this.hashLo = lo;
      this.hashHi = hi;
    }

    unmakeMove() {
      const p = --this.ply;
      const m = this.uMove[p];
      this.turn ^= 1;
      const us = this.turn;
      if (us === BLACK) this.fullmove--;
      this.castling = this.uCastling[p];
      this.ep = this.uEp[p];
      this.halfmove = this.uHalf[p];
      this.hashLo = this.uHashLo[p];
      this.hashHi = this.uHashHi[p];
      if (m === 0) return; // prázdný tah

      const b = this.board;
      const from = m & 127, to = (m >> 7) & 127, promo = (m >> 14) & 7, flags = m >> 17;
      const piece = promo ? PAWN | (us << 3) : b[to];
      const captured = this.uCaptured[p];
      b[from] = piece;
      if (flags & F_EP) {
        b[to] = 0;
        b[to + (us === WHITE ? -16 : 16)] = captured;
      } else {
        b[to] = captured;
      }
      if (flags & F_CASTLE) {
        const rf = to > from ? from + 3 : from - 4;
        const rt = to > from ? from + 1 : from - 1;
        b[rf] = b[rt];
        b[rt] = 0;
      }
      if ((piece & 7) === KING) this.kings[us] = from;
    }

    // „prázdný tah" pro null-move pruning ve vyhledávání
    makeNull() {
      const p = this.ply++;
      this.uMove[p] = 0;
      this.uCastling[p] = this.castling;
      this.uEp[p] = this.ep;
      this.uHalf[p] = this.halfmove;
      this.uHashLo[p] = this.hashLo;
      this.uHashHi[p] = this.hashHi;
      this.uCaptured[p] = 0;
      if (this.ep >= 0) { this.hashLo ^= Z_EP_LO[this.ep & 7]; this.hashHi ^= Z_EP_HI[this.ep & 7]; }
      this.ep = -1;
      this.halfmove = 0; // opakování se nehledá přes prázdný tah
      this.hashLo ^= Z_SIDE_LO;
      this.hashHi ^= Z_SIDE_HI;
      if (this.turn === BLACK) this.fullmove++;
      this.turn ^= 1;
    }

    unmakeNull() {
      this.unmakeMove();
    }

    // ---------- Napadení ----------
    isAttacked(sq, by) {
      const b = this.board;
      if (by === WHITE) {
        if (!((sq - 15) & 0x88) && b[sq - 15] === W_PAWN) return true;
        if (!((sq - 17) & 0x88) && b[sq - 17] === W_PAWN) return true;
      } else {
        if (!((sq + 15) & 0x88) && b[sq + 15] === B_PAWN) return true;
        if (!((sq + 17) & 0x88) && b[sq + 17] === B_PAWN) return true;
      }
      const base = by << 3;
      const knight = base | KNIGHT, king = base | KING;
      for (let i = 0; i < 8; i++) {
        let s = sq + KNIGHT_DIRS[i];
        if (!(s & 0x88) && b[s] === knight) return true;
        s = sq + KING_DIRS[i];
        if (!(s & 0x88) && b[s] === king) return true;
      }
      const bishop = base | BISHOP, rook = base | ROOK, queen = base | QUEEN;
      for (let i = 0; i < 4; i++) {
        let d = BISHOP_DIRS[i], s = sq + d;
        while (!(s & 0x88)) {
          const p = b[s];
          if (p) { if (p === bishop || p === queen) return true; break; }
          s += d;
        }
        d = ROOK_DIRS[i];
        s = sq + d;
        while (!(s & 0x88)) {
          const p = b[s];
          if (p) { if (p === rook || p === queen) return true; break; }
          s += d;
        }
      }
      return false;
    }

    // seznam polí s figurami strany `by`, které napadají pole `sq`
    attackers(sq, by) {
      const b = this.board, out = [];
      const pawn = by === WHITE ? W_PAWN : B_PAWN;
      const pd = by === WHITE ? -16 : 16;
      for (const s of [sq + pd - 1, sq + pd + 1]) if (!(s & 0x88) && b[s] === pawn) out.push(s);
      const base = by << 3;
      for (let i = 0; i < 8; i++) {
        let s = sq + KNIGHT_DIRS[i];
        if (!(s & 0x88) && b[s] === (base | KNIGHT)) out.push(s);
        s = sq + KING_DIRS[i];
        if (!(s & 0x88) && b[s] === (base | KING)) out.push(s);
      }
      for (let i = 0; i < 8; i++) {
        const d = KING_DIRS[i];
        const diag = i === 0 || i === 2 || i === 5 || i === 7;
        let s = sq + d;
        while (!(s & 0x88)) {
          const p = b[s];
          if (p) {
            const t = p & 7;
            if ((p >> 3) === by && (t === QUEEN || t === (diag ? BISHOP : ROOK))) out.push(s);
            break;
          }
          s += d;
        }
      }
      return out;
    }

    // pole, která napadá figura stojící na `sq`
    attacksFrom(sq) {
      const b = this.board, p = b[sq], out = [];
      if (!p) return out;
      const t = p & 7, color = p >> 3;
      if (t === PAWN) {
        const pd = color === WHITE ? 16 : -16;
        for (const s of [sq + pd - 1, sq + pd + 1]) if (!(s & 0x88)) out.push(s);
      } else if (t === KNIGHT || t === KING) {
        for (const d of t === KNIGHT ? KNIGHT_DIRS : KING_DIRS) if (!((sq + d) & 0x88)) out.push(sq + d);
      } else {
        const dirs = t === BISHOP ? BISHOP_DIRS : t === ROOK ? ROOK_DIRS : KING_DIRS;
        for (const d of dirs) {
          let s = sq + d;
          while (!(s & 0x88)) {
            out.push(s);
            if (b[s]) break;
            s += d;
          }
        }
      }
      return out;
    }

    inCheck() {
      return this.isAttacked(this.kings[this.turn], this.turn ^ 1);
    }

    // ---------- Generátor tahů ----------
    // pseudolegální tahy (bez ověření, zda vlastní král nezůstane v šachu)
    genMoves(list, capturesOnly) {
      const b = this.board, us = this.turn;
      for (let sq = 0; sq < 120; sq++) {
        if (sq & 0x88) { sq += 7; continue; }
        const p = b[sq];
        if (!p || (p >> 3) !== us) continue;
        const t = p & 7;
        if (t === PAWN) this.genPawn(list, sq, capturesOnly);
        else if (t === KNIGHT) this.genStep(list, sq, KNIGHT_DIRS, capturesOnly);
        else if (t === KING) this.genStep(list, sq, KING_DIRS, capturesOnly);
        else {
          if (t !== ROOK) this.genSlide(list, sq, BISHOP_DIRS, capturesOnly);
          if (t !== BISHOP) this.genSlide(list, sq, ROOK_DIRS, capturesOnly);
        }
      }
      if (!capturesOnly) this.genCastling(list);
      return list;
    }

    genStep(list, from, dirs, capturesOnly) {
      const b = this.board, us = this.turn;
      for (let i = 0; i < 8; i++) {
        const to = from + dirs[i];
        if (to & 0x88) continue;
        const q = b[to];
        if (!q) { if (!capturesOnly) list.push(encodeMove(from, to, 0, 0)); }
        else if ((q >> 3) !== us) list.push(encodeMove(from, to, 0, F_CAPTURE));
      }
    }

    genSlide(list, from, dirs, capturesOnly) {
      const b = this.board, us = this.turn;
      for (let i = 0; i < 4; i++) {
        const d = dirs[i];
        let to = from + d;
        while (!(to & 0x88)) {
          const q = b[to];
          if (!q) {
            if (!capturesOnly) list.push(encodeMove(from, to, 0, 0));
          } else {
            if ((q >> 3) !== us) list.push(encodeMove(from, to, 0, F_CAPTURE));
            break;
          }
          to += d;
        }
      }
    }

    genPawn(list, from, capturesOnly) {
      const b = this.board, us = this.turn;
      const fwd = us === WHITE ? 16 : -16;
      const rank = from >> 4;
      const promoting = rank === (us === WHITE ? 6 : 1);
      const one = from + fwd;
      if (!b[one]) {
        if (promoting) this.pushPromos(list, from, one, 0, capturesOnly);
        else if (!capturesOnly) {
          list.push(encodeMove(from, one, 0, 0));
          if (rank === (us === WHITE ? 1 : 6) && !b[one + fwd]) list.push(encodeMove(from, one + fwd, 0, F_DOUBLE));
        }
      }
      for (let side = -1; side <= 1; side += 2) {
        const to = one + side;
        if (to & 0x88) continue;
        const q = b[to];
        if (q) {
          if ((q >> 3) !== us) {
            if (promoting) this.pushPromos(list, from, to, F_CAPTURE, capturesOnly);
            else list.push(encodeMove(from, to, 0, F_CAPTURE));
          }
        } else if (to === this.ep) {
          list.push(encodeMove(from, to, 0, F_CAPTURE | F_EP));
        }
      }
    }

    pushPromos(list, from, to, flags, queenOnly) {
      list.push(encodeMove(from, to, QUEEN, flags));
      if (queenOnly) return;
      list.push(encodeMove(from, to, KNIGHT, flags));
      list.push(encodeMove(from, to, ROOK, flags));
      list.push(encodeMove(from, to, BISHOP, flags));
    }

    genCastling(list) {
      const b = this.board, c = this.castling;
      const white = this.turn === WHITE;
      const k = white ? 4 : 116;
      const them = white ? BLACK : WHITE;
      if (!(c & (white ? 3 : 12)) || b[k] !== (white ? W_KING : B_KING)) return;
      const rook = white ? W_ROOK : B_ROOK;
      if ((c & (white ? 1 : 4)) && !b[k + 1] && !b[k + 2] && b[k + 3] === rook &&
        !this.isAttacked(k, them) && !this.isAttacked(k + 1, them) && !this.isAttacked(k + 2, them)) {
        list.push(encodeMove(k, k + 2, 0, F_CASTLE));
      }
      if ((c & (white ? 2 : 8)) && !b[k - 1] && !b[k - 2] && !b[k - 3] && b[k - 4] === rook &&
        !this.isAttacked(k, them) && !this.isAttacked(k - 1, them) && !this.isAttacked(k - 2, them)) {
        list.push(encodeMove(k, k - 2, 0, F_CASTLE));
      }
    }

    legalMoves() {
      const list = this.genMoves([], false), legal = [];
      const us = this.turn;
      for (const m of list) {
        this.makeMove(m);
        if (!this.isAttacked(this.kings[us], us ^ 1)) legal.push(m);
        this.unmakeMove();
      }
      return legal;
    }

    hasLegalMove() {
      const list = this.genMoves([], false);
      const us = this.turn;
      for (const m of list) {
        this.makeMove(m);
        const ok = !this.isAttacked(this.kings[us], us ^ 1);
        this.unmakeMove();
        if (ok) return true;
      }
      return false;
    }

    moveFromUci(uci) {
      if (typeof uci !== 'string' || uci.length < 4) return 0;
      const from = sqFromName(uci.slice(0, 2)), to = sqFromName(uci.slice(2, 4));
      const promo = uci.length > 4 ? '  nbrq'.indexOf(uci[4].toLowerCase()) : 0;
      return this.legalMoves().find((m) => moveFrom(m) === from && moveTo(m) === to && movePromo(m) === promo) || 0;
    }

    // ---------- Konec hry ----------
    isRepetition() {
      const lo = this.hashLo, hi = this.hashHi;
      const stop = Math.max(0, this.ply - this.halfmove);
      for (let i = this.ply - 2; i >= stop; i -= 2) {
        if (this.uHashLo[i] === lo && this.uHashHi[i] === hi) return true;
      }
      return false;
    }

    repetitionCount() {
      let n = 1;
      const stop = Math.max(0, this.ply - this.halfmove);
      for (let i = this.ply - 2; i >= stop; i -= 2) {
        if (this.uHashLo[i] === this.hashLo && this.uHashHi[i] === this.hashHi) n++;
      }
      return n;
    }

    // ani jedna strana nemůže dát mat (K–K, K+lehká figura–K, střelci na stejné barvě)
    insufficientMaterial() {
      const b = this.board;
      let minors = 0, knights = 0, bishopColors = 0;
      for (let sq = 0; sq < 120; sq++) {
        if (sq & 0x88) { sq += 7; continue; }
        const t = b[sq] & 7;
        if (!t || t === KING) continue;
        if (t === PAWN || t === ROOK || t === QUEEN) return false;
        minors++;
        if (t === KNIGHT) knights++;
        else bishopColors |= 1 << (((sq >> 4) + (sq & 7)) & 1);
      }
      if (minors <= 1) return true;
      return knights === 0 && bishopColors !== 3;
    }

    // stav partie z pohledu strany na tahu
    status() {
      const moves = this.legalMoves();
      const check = this.inCheck();
      if (!moves.length) {
        return check
          ? { over: true, reason: 'checkmate', winner: this.turn ^ 1, check, moves }
          : { over: true, reason: 'stalemate', winner: -1, check, moves };
      }
      if (this.insufficientMaterial()) return { over: true, reason: 'material', winner: -1, check, moves };
      if (this.halfmove >= 100) return { over: true, reason: 'fifty', winner: -1, check, moves };
      if (this.repetitionCount() >= 3) return { over: true, reason: 'repetition', winner: -1, check, moves };
      return { over: false, reason: null, winner: -1, check, moves };
    }

    // ---------- Notace ----------
    san(m, letters, legal) {
      letters = letters || LETTERS_CS;
      legal = legal || this.legalMoves();
      const from = moveFrom(m), to = moveTo(m), flags = moveFlags(m), promo = movePromo(m);
      const piece = this.board[from], t = piece & 7;
      let s;
      if (flags & F_CASTLE) {
        s = to > from ? 'O-O' : 'O-O-O';
      } else if (t === PAWN) {
        s = (flags & F_CAPTURE ? 'abcdefgh'[from & 7] + 'x' : '') + sqName(to);
        if (promo) s += '=' + letters[promo];
      } else {
        s = letters[t];
        let ambiguous = false, sameFile = false, sameRank = false;
        for (const o of legal) {
          const of = moveFrom(o);
          if (of === from || moveTo(o) !== to || this.board[of] !== piece) continue;
          ambiguous = true;
          if ((of & 7) === (from & 7)) sameFile = true;
          if ((of >> 4) === (from >> 4)) sameRank = true;
        }
        if (ambiguous) {
          if (!sameFile) s += 'abcdefgh'[from & 7];
          else if (!sameRank) s += (from >> 4) + 1;
          else s += sqName(from);
        }
        if (flags & F_CAPTURE) s += 'x';
        s += sqName(to);
      }
      this.makeMove(m);
      if (this.inCheck()) s += this.hasLegalMove() ? '+' : '#';
      this.unmakeMove();
      return s;
    }

    // ---------- Hodnocení (kladné = dobré pro stranu na tahu) ----------
    hasNonPawnMaterial(side) {
      const b = this.board;
      for (let sq = 0; sq < 120; sq++) {
        if (sq & 0x88) { sq += 7; continue; }
        const p = b[sq];
        if (p && (p >> 3) === side) {
          const t = p & 7;
          if (t !== PAWN && t !== KING) return true;
        }
      }
      return false;
    }

    evaluate() {
      const b = this.board;
      const pawns = this.evPawns; // 0–19 bílí, 20–39 černí
      const files = this.evFiles; // [0–7] počet bílých, [8–15] černých, [16–23] max. řada černých, [24–31] min. řada bílých
      for (let f = 0; f < 8; f++) { files[f] = 0; files[8 + f] = 0; files[16 + f] = -1; files[24 + f] = 8; }
      let mg = 0, eg = 0, phase = 0, nW = 0, nB = 0;
      let matW = 0, matB = 0, bishW = 0, bishB = 0;
      let rooks = 0; // bitová maska sloupců s věžemi: nízký bajt bílé, vyšší černé

      for (let sq = 0; sq < 120; sq++) {
        if (sq & 0x88) { sq += 7; continue; }
        const p = b[sq];
        if (!p) continue;
        const t = p & 7;
        phase += PHASE[t];
        if (p < 8) {
          mg += PST_MG[t][sq];
          eg += PST_EG[t][sq];
          if (t === PAWN) {
            const f = sq & 7, r = sq >> 4;
            files[f]++;
            if (r < files[24 + f]) files[24 + f] = r;
            if (nW < 20) pawns[nW++] = sq;
          } else if (t !== KING) {
            matW += PIECE_VALUE[t];
            if (t === BISHOP) bishW++;
            else if (t === ROOK) rooks |= 1 << (sq & 7);
          }
        } else {
          mg -= PST_MG[t][128 + sq];
          eg -= PST_EG[t][128 + sq];
          if (t === PAWN) {
            const f = sq & 7, r = sq >> 4;
            files[8 + f]++;
            if (r > files[16 + f]) files[16 + f] = r;
            if (nB < 20) pawns[20 + nB++] = sq;
          } else if (t !== KING) {
            matB += PIECE_VALUE[t];
            if (t === BISHOP) bishB++;
            else if (t === ROOK) rooks |= 256 << (sq & 7);
          }
        }
      }

      // pěšcová struktura
      for (let i = 0; i < nW; i++) {
        const sq = pawns[i], f = sq & 7, r = sq >> 4;
        const left = f > 0 ? f - 1 : f, right = f < 7 ? f + 1 : f;
        if (files[f] > 1) { mg -= 5; eg -= 10; }
        if ((f === 0 || !files[f - 1]) && (f === 7 || !files[f + 1])) { mg -= 10; eg -= 10; }
        let passed = true;
        for (let g = left; g <= right; g++) if (files[16 + g] > r) { passed = false; break; }
        // vlastní pěšec před ním → není volný
        if (passed && files[f] > 1) {
          for (let rr = r + 1; rr < 7; rr++) if (b[rr * 16 + f] === W_PAWN) { passed = false; break; }
        }
        if (passed) { mg += PASSED_MG[r]; eg += PASSED_EG[r]; }
      }
      for (let i = 0; i < nB; i++) {
        const sq = pawns[20 + i], f = sq & 7, r = sq >> 4;
        const left = f > 0 ? f - 1 : f, right = f < 7 ? f + 1 : f;
        if (files[8 + f] > 1) { mg += 5; eg += 10; }
        if ((f === 0 || !files[8 + f - 1]) && (f === 7 || !files[8 + f + 1])) { mg += 10; eg += 10; }
        let passed = true;
        for (let g = left; g <= right; g++) if (files[24 + g] < r) { passed = false; break; }
        if (passed && files[8 + f] > 1) {
          for (let rr = r - 1; rr > 0; rr--) if (b[rr * 16 + f] === B_PAWN) { passed = false; break; }
        }
        if (passed) { mg -= PASSED_MG[7 - r]; eg -= PASSED_EG[7 - r]; }
      }

      // věže na otevřených sloupcích
      for (let f = 0; f < 8; f++) {
        if (rooks & (1 << f)) {
          if (!files[f]) { mg += files[8 + f] ? 10 : 20; eg += 10; }
        }
        if (rooks & (256 << f)) {
          if (!files[8 + f]) { mg -= files[f] ? 10 : 20; eg -= 10; }
        }
      }

      // dvojice střelců
      if (bishW >= 2) { mg += 30; eg += 50; }
      if (bishB >= 2) { mg -= 30; eg -= 50; }

      // pěšcový štít před králem
      const kw = this.kings[WHITE], kb = this.kings[BLACK];
      if ((kw >> 4) === 0) {
        for (let d = 15; d <= 17; d++) if (!((kw + d) & 0x88) && b[kw + d] === W_PAWN) mg += 10;
      }
      if ((kb >> 4) === 7) {
        for (let d = 15; d <= 17; d++) if (!((kb - d) & 0x88) && b[kb - d] === B_PAWN) mg -= 10;
      }

      if (phase > 24) phase = 24;
      let score = ((mg * phase + eg * (24 - phase)) / 24) | 0;

      // koncovky: tlač soupeřova krále ke kraji, když vedeš bez pěšců na jeho straně
      if (score > 0 && nB === 0 && matW - matB >= 400) {
        score += 10 * centerDist(kb) + 4 * (14 - kingDist(kw, kb));
      } else if (score < 0 && nW === 0 && matB - matW >= 400) {
        score -= 10 * centerDist(kw) + 4 * (14 - kingDist(kw, kb));
      }
      // bez pěšců a s náskokem nejvýš lehké figury se vyhrát nedá
      if (score > 0 && nW === 0 && matW - matB < 400) score >>= 3;
      else if (score < 0 && nB === 0 && matB - matW < 400) score = -((-score) >> 3);

      return this.turn === WHITE ? score : -score;
    }

    perft(depth) {
      if (depth === 0) return 1;
      const list = this.genMoves([], false);
      const us = this.turn;
      let n = 0;
      for (const m of list) {
        this.makeMove(m);
        if (!this.isAttacked(this.kings[us], us ^ 1)) n += depth === 1 ? 1 : this.perft(depth - 1);
        this.unmakeMove();
      }
      return n;
    }
  }

  // ---------- Umělá inteligence: alfa-beta s iterativním prohlubováním ----------
  const INF = 1000000;
  const MATE = 100000;
  const MATE_BOUND = MATE - 1000;
  const MAX_PLY = 96;
  const TT_SIZE = 1 << 19, TT_MASK = TT_SIZE - 1;
  const TT_EXACT = 1, TT_LOWER = 2, TT_UPPER = 3;

  class Searcher {
    constructor() {
      this.ttKey = new Int32Array(TT_SIZE);
      this.ttMove = new Int32Array(TT_SIZE);
      this.ttScore = new Int32Array(TT_SIZE);
      this.ttDepth = new Int8Array(TT_SIZE);
      this.ttFlag = new Uint8Array(TT_SIZE);
      this.killers = new Int32Array((MAX_PLY + 1) * 2);
      this.history = new Int32Array(16 * 128);
      this.moveLists = [];
      this.scoreLists = [];
      for (let i = 0; i <= MAX_PLY; i++) { this.moveLists.push([]); this.scoreLists.push([]); }
    }

    /**
     * Najde nejlepší tah. opts: maxDepth, timeMs, noise (náhodný šum v setinách pěšce
     * pro slabší úrovně). Vrací { move, score, depth, nodes } nebo null bez tahů.
     */
    think(pos, opts) {
      opts = opts || {};
      const maxDepth = Math.min(opts.maxDepth || 64, MAX_PLY - 16);
      const timeMs = opts.timeMs || 1000;
      const noise = opts.noise || 0;
      const start = Date.now();
      this.pos = pos;
      this.deadline = start + timeMs;
      this.stopped = false;
      this.nodes = 0;
      this.killers.fill(0);
      for (let i = 0; i < this.history.length; i++) this.history[i] >>= 3;

      const root = pos.legalMoves();
      if (!root.length) return null;
      let bestMove = root[0], bestScore = 0, done = 0;

      for (let d = 1; d <= maxDepth; d++) {
        this.curDepth = d;
        let score, move;
        if (noise) {
          const r = this.searchNoisy(root, d, noise);
          score = r.score;
          move = r.move;
        } else {
          this.rootBest = 0;
          score = this.search(d, -INF, INF, 0, false);
          move = this.rootBest;
        }
        if (move) bestMove = move;
        if (this.stopped) break;
        bestScore = score;
        done = d;
        if (root.length === 1) break;
        if (Math.abs(score) > MATE_BOUND && d >= MATE - Math.abs(score)) break;
        if (Date.now() - start > timeMs * 0.55) break;
      }
      return { move: bestMove, score: bestScore, depth: done, nodes: this.nodes };
    }

    // kořen se šumem: každý tah ohodnotí přesně, pak přičte náhodu
    searchNoisy(root, depth, noise) {
      const pos = this.pos;
      let best = 0, bestVal = -INF, bestScore = -INF;
      for (const m of root) {
        pos.makeMove(m);
        const s = -this.search(depth - 1, -INF, INF, 1, true);
        pos.unmakeMove();
        if (this.stopped) return { move: 0, score: 0 };
        const v = s + Math.random() * noise;
        if (v > bestVal) { bestVal = v; best = m; bestScore = s; }
      }
      return { move: best, score: bestScore };
    }

    checkTime() {
      if (this.curDepth > 1 && Date.now() >= this.deadline) this.stopped = true;
    }

    scoreMoves(moves, scores, ttMove, ply) {
      const b = this.pos.board;
      const k1 = this.killers[ply * 2], k2 = this.killers[ply * 2 + 1];
      for (let i = 0; i < moves.length; i++) {
        const m = moves[i];
        const flags = m >> 17;
        let s;
        if (m === ttMove) s = 10000000;
        else if (flags & F_CAPTURE) {
          const victim = flags & F_EP ? PAWN : b[(m >> 7) & 127] & 7;
          s = 1000000 + victim * 100 - (b[m & 127] & 7) + ((m >> 14) & 7) * 10;
        } else if ((m >> 14) & 7) s = 950000 + ((m >> 14) & 7);
        else if (m === k1) s = 900000;
        else if (m === k2) s = 800000;
        else s = this.history[b[m & 127] * 128 + ((m >> 7) & 127)];
        scores[i] = s;
      }
    }

    pickMove(moves, scores, i) {
      let bi = i;
      for (let j = i + 1; j < moves.length; j++) if (scores[j] > scores[bi]) bi = j;
      if (bi !== i) {
        const tm = moves[i]; moves[i] = moves[bi]; moves[bi] = tm;
        const ts = scores[i]; scores[i] = scores[bi]; scores[bi] = ts;
      }
      return moves[i];
    }

    search(depth, alpha, beta, ply, allowNull) {
      const pos = this.pos;
      if ((++this.nodes & 1023) === 0) this.checkTime();
      if (this.stopped) return 0;

      const inCheck = pos.inCheck();
      if (inCheck) depth++;
      if (depth <= 0) return this.quiesce(alpha, beta, ply);
      if (ply >= MAX_PLY - 1) return pos.evaluate();

      if (ply > 0) {
        if (pos.halfmove >= 100 || pos.isRepetition() || pos.insufficientMaterial()) return 0;
        // vzdálenost k matu
        if (alpha < -MATE + ply) alpha = -MATE + ply;
        if (beta > MATE - ply - 1) beta = MATE - ply - 1;
        if (alpha >= beta) return alpha;
      }

      const isPv = beta - alpha > 1;
      const idx = pos.hashLo & TT_MASK;
      let ttMove = 0;
      if (this.ttFlag[idx] && this.ttKey[idx] === pos.hashHi) {
        ttMove = this.ttMove[idx];
        if (!isPv && ply > 0 && this.ttDepth[idx] >= depth) {
          let s = this.ttScore[idx];
          if (s > MATE_BOUND) s -= ply;
          else if (s < -MATE_BOUND) s += ply;
          const f = this.ttFlag[idx];
          if (f === TT_EXACT || (f === TT_LOWER && s >= beta) || (f === TT_UPPER && s <= alpha)) return s;
        }
      }

      // null move: když ani tah navíc soupeři nepomůže, větev se dá useknout
      if (allowNull && !inCheck && !isPv && depth >= 3 && Math.abs(beta) < MATE_BOUND &&
        pos.hasNonPawnMaterial(pos.turn) && pos.evaluate() >= beta) {
        const R = depth > 6 ? 3 : 2;
        pos.makeNull();
        const s = -this.search(depth - 1 - R, -beta, -beta + 1, ply + 1, false);
        pos.unmakeNull();
        if (this.stopped) return 0;
        if (s >= beta) return s >= MATE_BOUND ? beta : s;
      }

      const moves = this.moveLists[ply];
      moves.length = 0;
      pos.genMoves(moves, false);
      const scores = this.scoreLists[ply];
      scores.length = moves.length;
      this.scoreMoves(moves, scores, ttMove, ply);

      const us = pos.turn, them = us ^ 1;
      const origAlpha = alpha;
      let best = -INF, bestMove = 0, legal = 0;

      for (let i = 0; i < moves.length; i++) {
        const m = this.pickMove(moves, scores, i);
        pos.makeMove(m);
        if (pos.isAttacked(pos.kings[us], them)) { pos.unmakeMove(); continue; }
        legal++;
        const quiet = !((m >> 17) & F_CAPTURE) && !((m >> 14) & 7);
        let s;
        if (legal === 1) {
          s = -this.search(depth - 1, -beta, -alpha, ply + 1, true);
        } else {
          // pozdní tihé tahy prohledáme mělčeji (LMR)
          let r = 0;
          if (depth >= 3 && legal > 3 && quiet && !inCheck &&
            m !== this.killers[ply * 2] && m !== this.killers[ply * 2 + 1] && !pos.inCheck()) {
            r = legal > 8 ? 2 : 1;
          }
          s = -this.search(depth - 1 - r, -alpha - 1, -alpha, ply + 1, true);
          if (s > alpha && r) s = -this.search(depth - 1, -alpha - 1, -alpha, ply + 1, true);
          if (s > alpha && s < beta) s = -this.search(depth - 1, -beta, -alpha, ply + 1, true);
        }
        pos.unmakeMove();
        if (this.stopped) return 0;

        if (s > best) {
          best = s;
          bestMove = m;
          if (ply === 0) this.rootBest = m;
          if (s > alpha) {
            alpha = s;
            if (s >= beta) {
              if (quiet) {
                if (this.killers[ply * 2] !== m) {
                  this.killers[ply * 2 + 1] = this.killers[ply * 2];
                  this.killers[ply * 2] = m;
                }
                const h = pos.board[m & 127] * 128 + ((m >> 7) & 127);
                this.history[h] += depth * depth;
                if (this.history[h] > 400000) for (let j = 0; j < this.history.length; j++) this.history[j] >>= 1;
              }
              break;
            }
          }
        }
      }

      if (!legal) return inCheck ? -MATE + ply : 0;

      const flag = best >= beta ? TT_LOWER : best > origAlpha ? TT_EXACT : TT_UPPER;
      if (this.ttKey[idx] !== pos.hashHi || depth >= this.ttDepth[idx] || flag === TT_EXACT) {
        let s = best;
        if (s > MATE_BOUND) s += ply;
        else if (s < -MATE_BOUND) s -= ply;
        this.ttKey[idx] = pos.hashHi;
        this.ttMove[idx] = bestMove;
        this.ttScore[idx] = s;
        this.ttDepth[idx] = depth;
        this.ttFlag[idx] = flag;
      }
      return best;
    }

    // klidové hledání: dopočítá braní, aby hodnocení nebylo uprostřed výměny
    quiesce(alpha, beta, ply) {
      const pos = this.pos;
      if ((++this.nodes & 1023) === 0) this.checkTime();
      if (this.stopped) return 0;
      if (ply >= MAX_PLY - 1) return pos.evaluate();

      const inCheck = pos.inCheck();
      let best;
      if (inCheck) {
        best = -MATE + ply;
      } else {
        best = pos.evaluate();
        if (best >= beta) return best;
        if (best > alpha) alpha = best;
      }

      const moves = this.moveLists[ply];
      moves.length = 0;
      pos.genMoves(moves, !inCheck);
      const scores = this.scoreLists[ply];
      scores.length = moves.length;
      this.scoreMoves(moves, scores, 0, ply);
      const us = pos.turn, them = us ^ 1;

      for (let i = 0; i < moves.length; i++) {
        const m = this.pickMove(moves, scores, i);
        pos.makeMove(m);
        if (pos.isAttacked(pos.kings[us], them)) { pos.unmakeMove(); continue; }
        const s = -this.quiesce(-beta, -alpha, ply + 1);
        pos.unmakeMove();
        if (this.stopped) return 0;
        if (s > best) {
          best = s;
          if (s > alpha) {
            alpha = s;
            if (s >= beta) break;
          }
        }
      }
      return best;
    }
  }

  // ---------- Knihovna zahájení ----------
  const OPENINGS = [
    ['Italská hra', 'e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 c2c3 g8f6 d2d3 d7d6'],
    ['Italská hra – obrana dvou jezdců', 'e2e4 e7e5 g1f3 b8c6 f1c4 g8f6 d2d3 f8e7 e1g1 e8g8'],
    ['Španělská hra', 'e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1g1 f8e7 f1e1 b7b5 a4b3 d7d6'],
    ['Skotská hra', 'e2e4 e7e5 g1f3 b8c6 d2d4 e5d4 f3d4 g8f6 d4c6 b7c6'],
    ['Ruská hra (Petrovova obrana)', 'e2e4 e7e5 g1f3 g8f6 f3e5 d7d6 e5f3 f6e4 d2d4 d6d5'],
    ['Hra čtyř jezdců', 'e2e4 e7e5 b1c3 g8f6 g1f3 b8c6 f1b5 f8b4 e1g1 e8g8'],
    ['Sicilská obrana', 'e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6'],
    ['Sicilská obrana', 'e2e4 c7c5 g1f3 b8c6 d2d4 c5d4 f3d4 g8f6 b1c3 e7e5'],
    ['Sicilská obrana – Alapinova varianta', 'e2e4 c7c5 c2c3 g8f6 e4e5 f6d5 d2d4 c5d4'],
    ['Francouzská obrana', 'e2e4 e7e6 d2d4 d7d5 b1c3 g8f6 c1g5 f8e7 e4e5 f6d7'],
    ['Francouzská obrana – postupová varianta', 'e2e4 e7e6 d2d4 d7d5 e4e5 c7c5 c2c3 b8c6 g1f3'],
    ['Caro-Kannova obrana', 'e2e4 c7c6 d2d4 d7d5 b1c3 d5e4 c3e4 c8f5 e4g3 f5g6'],
    ['Skandinávská obrana', 'e2e4 d7d5 e4d5 d8d5 b1c3 d5a5 d2d4 g8f6 g1f3'],
    ['Pircova obrana', 'e2e4 d7d6 d2d4 g8f6 b1c3 g7g6 g1f3 f8g7 f1e2 e8g8'],
    ['Dámský gambit', 'd2d4 d7d5 c2c4 e7e6 b1c3 g8f6 c1g5 f8e7 e2e3 e8g8 g1f3'],
    ['Dámský gambit – slovanská obrana', 'd2d4 d7d5 c2c4 c7c6 g1f3 g8f6 b1c3 d5c4 a2a4 c8f5'],
    ['Dámský gambit přijatý', 'd2d4 d7d5 c2c4 d5c4 g1f3 g8f6 e2e3 e7e6 f1c4 c7c5'],
    ['Londýnský systém', 'd2d4 d7d5 c1f4 g8f6 e2e3 c7c5 c2c3 b8c6 g1f3'],
    ['Královská indická obrana', 'd2d4 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6 g1f3 e8g8 f1e2 e7e5'],
    ['Nimcovičova indická obrana', 'd2d4 g8f6 c2c4 e7e6 b1c3 f8b4 e2e3 e8g8 f1d3 d7d5'],
    ['Dámská indická obrana', 'd2d4 g8f6 c2c4 e7e6 g1f3 b7b6 g2g3 c8b7 f1g2 f8e7 e1g1 e8g8'],
    ['Anglická hra', 'c2c4 e7e5 b1c3 g8f6 g2g3 d7d5 c4d5 f6d5 f1g2'],
    ['Rétiho hra', 'g1f3 d7d5 g2g3 g8f6 f1g2 e7e6 e1g1 f8e7 d2d3'],
  ].map(([name, line]) => ({ name, moves: line.split(' ') }));

  // náhodné pokračování z knihovny (jen ze základního postavení)
  function bookMove(moves) {
    const n = moves.length;
    const options = [];
    for (const o of OPENINGS) {
      if (o.moves.length <= n) continue;
      let ok = true;
      for (let i = 0; i < n; i++) if (o.moves[i] !== moves[i]) { ok = false; break; }
      if (ok) options.push(o.moves[n]);
    }
    return options.length ? options[Math.floor(Math.random() * options.length)] : null;
  }

  // název zahájení podle odehraných tahů (až když je jednoznačný)
  function openingName(moves) {
    let bestK = 0, names = [];
    for (const o of OPENINGS) {
      const lim = Math.min(o.moves.length, moves.length);
      let k = 0;
      while (k < lim && o.moves[k] === moves[k]) k++;
      if (k < lim || k < 3) continue;
      if (k > bestK) { bestK = k; names = [o.name]; }
      else if (k === bestK) names.push(o.name);
    }
    if (!names.length) return null;
    const family = names[0].split(' – ')[0];
    if (names.every((x) => x === names[0])) return names[0];
    return names.every((x) => x.split(' – ')[0] === family) ? family : null;
  }

  const Chess = {
    WHITE, BLACK, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING,
    F_CAPTURE, F_DOUBLE, F_EP, F_CASTLE,
    START_FEN, PIECE_VALUE, MATE, MATE_BOUND, LETTERS_CS, LETTERS_EN, OPENINGS,
    Position, Searcher,
    encodeMove, moveFrom, moveTo, movePromo, moveFlags, moveToUci, sqName, sqFromName,
    bookMove, openingName,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Chess;
  else global.Chess = Chess;
})(typeof self !== 'undefined' ? self : globalThis);
