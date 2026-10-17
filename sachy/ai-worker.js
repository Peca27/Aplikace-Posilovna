'use strict';

/* Šachy — Web Worker: počítač hledá tah mimo hlavní vlákno, aby aplikace nezamrzala.
   Zpráva: { id, fen, moves: ['e2e4', …], opts: { maxDepth, timeMs, noise } } */

importScripts('engine.js');

const searcher = new Chess.Searcher();

self.onmessage = (ev) => {
  const { id, fen, moves, opts } = ev.data;
  const pos = new Chess.Position(fen);
  for (const u of moves) {
    const m = pos.moveFromUci(u);
    if (!m) break;
    pos.makeMove(m);
  }
  const res = searcher.think(pos, opts);
  self.postMessage({
    id,
    move: res ? Chess.moveToUci(res.move) : null,
    score: res ? res.score : 0,
    depth: res ? res.depth : 0,
  });
};
