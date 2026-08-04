'use strict';

/* =====================================================
   Posilka — tréninkový deník (offline PWA)
   Data: localStorage, klíče s prefixem "posilka."
   ===================================================== */

// ---------- Úložiště ----------
const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem('posilka.' + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    localStorage.setItem('posilka.' + key, JSON.stringify(value));
  },
};

const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

// ---------- Výchozí cviky ----------
// group: 'upper' (vršek, +2,5 kg) | 'lower' (spodek, +5 kg)
const SEED_EXERCISES = [
  { id: 'bench',    name: 'Bench Press',     group: 'upper', sets: 5, reps: 5 },
  { id: 'squat',    name: 'Dřep',            group: 'lower', sets: 5, reps: 5 },
  { id: 'deadlift', name: 'Mrtvý tah',       group: 'lower', sets: 5, reps: 5 },
  { id: 'row',      name: 'Přítahy',         group: 'upper', sets: 5, reps: 5 },
  { id: 'ohp',      name: 'Tlaky nad hlavu', group: 'upper', sets: 5, reps: 5 },
];

// ---------- Stav ----------
let exercises = store.get('exercises', null);
if (!exercises || !Array.isArray(exercises) || !exercises.length) {
  exercises = SEED_EXERCISES.map((e) => ({ ...e }));
  store.set('exercises', exercises);
}
let workouts = store.get('workouts', []); // chronologicky (nejstarší první)
let current = store.get('current', null); // rozdělaný trénink
let settings = Object.assign({ rest: 90 }, store.get('settings', {}));

let activeTab = 'train';
let statsExId = null;
let statsPointIdx = null;

const saveExercises = () => store.set('exercises', exercises);
const saveWorkouts = () => store.set('workouts', workouts);
const saveCurrent = () => store.set('current', current);
const saveSettings = () => store.set('settings', settings);

// ---------- Pomocné ----------
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtNum = (n) =>
  Number(n).toLocaleString('cs-CZ', { maximumFractionDigits: 2 });

const fmtKg = (n) => (n == null || isNaN(n) ? '–' : fmtNum(n) + ' kg');

const fmtDate = (iso, opts) =>
  new Date(iso).toLocaleDateString('cs-CZ', opts || { weekday: 'short', day: 'numeric', month: 'numeric' });

const fmtDateLong = (iso) =>
  new Date(iso).toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

const groupLabel = (g) => (g === 'lower' ? 'Spodek' : 'Vršek');

// ---------- Progresivní přetížení ----------
const increment = (ex) => (ex.group === 'lower' ? 5 : 2.5);

function findExercise(id) {
  return exercises.find((e) => e.id === id) || null;
}

/** Poslední odcvičený záznam daného cviku v historii. */
function lastEntryFor(exId) {
  for (let i = workouts.length - 1; i >= 0; i--) {
    const entry = workouts[i].entries.find((e) => e.exId === exId && e.sets.length);
    if (entry) return { date: workouts[i].date, entry };
  }
  return null;
}

/**
 * Návrh váhy: pokud minule uživatel splnil cílový počet sérií
 * i opakování, navrhne se váha + přírůstek (2,5 / 5 kg).
 */
function suggestion(ex) {
  const last = lastEntryFor(ex.id);
  if (!last) return null;
  const target = last.entry.target || { sets: ex.sets, reps: ex.reps };
  const weight = Math.max(...last.entry.sets.map((s) => Number(s.w) || 0));
  const okSets = last.entry.sets.filter((s) => (Number(s.r) || 0) >= target.reps).length;
  const met = okSets >= target.sets && weight > 0;
  const inc = increment(ex);
  return {
    lastWeight: weight,
    met,
    inc,
    next: met ? weight + inc : weight,
    date: last.date,
    target,
  };
}

// ---------- Trénink ----------
function startWorkout() {
  current = { id: uid(), date: new Date().toISOString(), entries: [] };
  saveCurrent();
  render();
}

function addExerciseToWorkout(exId) {
  const ex = findExercise(exId);
  if (!ex || !current) return;
  if (current.entries.some((e) => e.exId === exId)) {
    closeSheet();
    return;
  }
  const sug = suggestion(ex);
  const w = sug && sug.next > 0 ? sug.next : '';
  current.entries.push({
    exId: ex.id,
    name: ex.name,
    group: ex.group,
    target: { sets: ex.sets, reps: ex.reps },
    sets: Array.from({ length: ex.sets }, () => ({ w, r: ex.reps, done: false })),
  });
  saveCurrent();
  closeSheet();
  render();
}

function toggleSet(ei, si) {
  const set = current.entries[ei] && current.entries[ei].sets[si];
  if (!set) return;
  set.done = !set.done;
  saveCurrent();
  if (set.done) startRest();
  render();
}

function addSet(ei) {
  const entry = current.entries[ei];
  if (!entry) return;
  const prev = entry.sets[entry.sets.length - 1];
  entry.sets.push({ w: prev ? prev.w : '', r: prev ? prev.r : entry.target.reps, done: false });
  saveCurrent();
  render();
}

function removeSet(ei) {
  const entry = current.entries[ei];
  if (!entry || entry.sets.length <= 1) return;
  entry.sets.pop();
  saveCurrent();
  render();
}

function removeEntry(ei) {
  if (!confirm('Odebrat cvik z tréninku?')) return;
  current.entries.splice(ei, 1);
  saveCurrent();
  render();
}

function finishWorkout() {
  const entries = current.entries
    .map((e) => ({ ...e, sets: e.sets.filter((s) => s.done).map((s) => ({ w: Number(s.w) || 0, r: Number(s.r) || 0 })) }))
    .filter((e) => e.sets.length);

  if (!entries.length) {
    if (!confirm('Nemáš odškrtnutou žádnou sérii. Zahodit trénink?')) return;
  } else {
    workouts.push({ id: current.id, date: current.date, end: new Date().toISOString(), entries });
    saveWorkouts();
  }
  current = null;
  saveCurrent();
  stopRest();
  activeTab = entries.length ? 'history' : 'train';
  render();
}

function cancelWorkout() {
  if (!confirm('Opravdu zrušit rozdělaný trénink? Data se neuloží.')) return;
  current = null;
  saveCurrent();
  stopRest();
  render();
}

function deleteWorkout(id) {
  if (!confirm('Smazat tento trénink z historie?')) return;
  workouts = workouts.filter((w) => w.id !== id);
  saveWorkouts();
  closeSheet();
  render();
}

// ---------- Stopky (pauza mezi sériemi) ----------
let rest = null; // { endsAt, total }
let restInterval = null;

function startRest() {
  ensureAudio();
  rest = { endsAt: Date.now() + settings.rest * 1000, total: settings.rest * 1000 };
  if (!restInterval) restInterval = setInterval(tickRest, 250);
  renderTimer();
}

function tickRest() {
  if (!rest) return;
  if (rest.endsAt - Date.now() <= 0) {
    beep();
    stopRest();
  } else {
    renderTimer();
  }
}

function stopRest() {
  rest = null;
  if (restInterval) {
    clearInterval(restInterval);
    restInterval = null;
  }
  renderTimer();
}

function addRestTime(sec) {
  if (!rest) return;
  rest.endsAt += sec * 1000;
  rest.total += sec * 1000;
  renderTimer();
}

function renderTimer() {
  const bar = document.getElementById('timerbar');
  if (!rest) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  const left = Math.max(0, rest.endsAt - Date.now());
  const m = Math.floor(left / 60000);
  const s = Math.ceil((left % 60000) / 1000) % 60;
  document.getElementById('timer-time').textContent = `${m}:${String(s).padStart(2, '0')}`;
  const frac = rest.total > 0 ? left / rest.total : 0;
  document.getElementById('timer-progress').style.transform = `scaleX(${frac})`;
}

// Zvukový signál po konci pauzy
let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch { /* bez zvuku */ }
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}

function beep() {
  if (navigator.vibrate) navigator.vibrate([180, 90, 180]);
  if (!audioCtx || audioCtx.state !== 'running') return;
  [0, 0.25, 0.5].forEach((t) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    const at = audioCtx.currentTime + t;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.4, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(at);
    osc.stop(at + 0.2);
  });
}

// ---------- Pohledy ----------
function render() {
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === activeTab));
  const view = document.getElementById('view');
  if (activeTab === 'train') view.innerHTML = viewTrain();
  else if (activeTab === 'history') view.innerHTML = viewHistory();
  else if (activeTab === 'stats') view.innerHTML = viewStats();
  else view.innerHTML = viewExercises();
  renderTimer();
}

// --- Instalační banner pro iOS ---
const isIOS =
  /iP(hone|ad|od)/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone =
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

function installBanner() {
  if (!isIOS || isStandalone || store.get('hideInstall', false)) return '';
  return `
    <div class="install-banner">
      <span class="emoji">📲</span>
      <p>Nainstaluj si Posilku jako aplikaci: klepni na <b>Sdílet</b>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="vertical-align:-2px"><path d="M12 15V3m0 0L8 7m4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>
      a zvol <b>„Přidat na plochu"</b>. Aplikace pak poběží celoobrazovkově a offline.</p>
      <button class="icon-btn" data-action="dismiss-install" aria-label="Zavřít">✕</button>
    </div>`;
}

// --- Trénink ---
function viewTrain() {
  let html = `<h1>Trénink</h1>
    <p class="subtitle">${esc(fmtDateLong(new Date().toISOString()))}</p>
    ${installBanner()}`;

  if (!current) {
    const last = workouts[workouts.length - 1];
    html += `
      <div class="card" style="text-align:center; padding: 28px 20px;">
        <div style="font-size:44px; margin-bottom: 8px;">🏋️</div>
        <h3 style="margin-bottom:6px;">Připraven na trénink?</h3>
        <p class="hint" style="margin-bottom:16px;">${
          last
            ? 'Naposledy: ' + esc(fmtDate(last.date, { weekday: 'long', day: 'numeric', month: 'numeric' }))
            : 'Zatím žádný záznam — začni ještě dnes.'
        }</p>
        <button class="btn" data-action="start-workout">Začít trénink</button>
      </div>`;
    return html;
  }

  current.entries.forEach((entry, ei) => {
    const ex = findExercise(entry.exId);
    const sug = ex ? suggestion(ex) : null;
    let hint = '';
    if (sug) {
      hint = sug.met
        ? `Minule ${fmtKg(sug.lastWeight)} — cíl splněn ✓ <span class="up">→ návrh ${fmtKg(sug.next)} (+${fmtNum(sug.inc)} kg)</span>`
        : `Minule ${fmtKg(sug.lastWeight)} — zůstaň na stejné váze a splň ${entry.target.sets}×${entry.target.reps}`;
    } else {
      hint = `První záznam — zapiš váhu, příště ti navrhnu progresi (cíl ${entry.target.sets}×${entry.target.reps})`;
    }

    const rows = entry.sets
      .map(
        (s, si) => `
        <div class="set-row ${s.done ? 'done' : ''}">
          <span class="set-num">${si + 1}</span>
          <input type="number" inputmode="decimal" step="0.5" min="0" placeholder="kg"
            value="${s.w === '' || s.w == null ? '' : esc(s.w)}" data-field="w" data-ei="${ei}" data-si="${si}" aria-label="Váha, série ${si + 1}">
          <span class="set-unit">kg</span>
          <span class="set-x">×</span>
          <input type="number" inputmode="numeric" step="1" min="0" placeholder="op."
            value="${s.r === '' || s.r == null ? '' : esc(s.r)}" data-field="r" data-ei="${ei}" data-si="${si}" aria-label="Opakování, série ${si + 1}">
          <button class="check ${s.done ? 'done' : ''}" data-action="toggle-set" data-ei="${ei}" data-si="${si}"
            aria-label="${s.done ? 'Série hotová' : 'Označit sérii jako hotovou'}">✓</button>
        </div>`
      )
      .join('');

    html += `
      <section class="card">
        <div class="entry-head">
          <h3>${esc(entry.name)}</h3>
          <button class="icon-btn" data-action="remove-entry" data-ei="${ei}" aria-label="Odebrat cvik">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          </button>
        </div>
        <p class="hint">${hint}</p>
        ${rows}
        <div class="row-actions">
          <button class="small-btn" data-action="add-set" data-ei="${ei}">+ série</button>
          ${entry.sets.length > 1 ? `<button class="small-btn muted" data-action="remove-set" data-ei="${ei}">− série</button>` : ''}
        </div>
      </section>`;
  });

  html += `
    <button class="btn secondary" data-action="open-add-exercise">＋ Přidat cvik</button>
    <button class="btn" data-action="finish-workout" style="margin-top:14px;">Ukončit a uložit trénink</button>
    <button class="btn ghost destructive" data-action="cancel-workout" style="background:none;">Zrušit trénink</button>`;
  return html;
}

// --- Historie ---
function summarizeEntry(entry) {
  const best = Math.max(...entry.sets.map((s) => s.w));
  const reps = entry.sets.map((s) => s.r);
  const sameReps = reps.every((r) => r === reps[0]);
  const scheme = sameReps ? `${entry.sets.length}×${reps[0]}` : `${entry.sets.length} sérií (${reps.join('/')})`;
  return { best, scheme };
}

function viewHistory() {
  let html = `<h1>Historie</h1>
    <p class="subtitle">${workouts.length} ${workouts.length === 1 ? 'trénink' : workouts.length >= 2 && workouts.length <= 4 ? 'tréninky' : 'tréninků'}</p>`;

  if (!workouts.length) {
    return html + `<div class="empty"><span class="big">📭</span>Zatím žádné tréninky.<br>Historie se objeví po prvním uloženém tréninku.</div>`;
  }

  [...workouts].reverse().forEach((w) => {
    const volume = w.entries.reduce((sum, e) => sum + e.sets.reduce((s2, s) => s2 + s.w * s.r, 0), 0);
    const lines = w.entries
      .map((e) => {
        const { best, scheme } = summarizeEntry(e);
        return `<li><span>${esc(e.name)} <span class="badge-group">${scheme}</span></span><span class="w">${fmtKg(best)}</span></li>`;
      })
      .join('');
    html += `
      <div class="card tappable" data-action="open-workout" data-id="${esc(w.id)}">
        <div class="history-date">${esc(fmtDate(w.date, { weekday: 'long', day: 'numeric', month: 'numeric', year: 'numeric' }))}</div>
        <div class="history-meta">${w.entries.length} ${w.entries.length === 1 ? 'cvik' : w.entries.length <= 4 ? 'cviky' : 'cviků'} · objem ${fmtNum(Math.round(volume))} kg</div>
        <ul class="history-lines">${lines}</ul>
      </div>`;
  });
  return html;
}

function openWorkoutDetail(id) {
  const w = workouts.find((x) => x.id === id);
  if (!w) return;
  const sections = w.entries
    .map((e) => {
      const rows = e.sets
        .map((s, i) => `<li><span>Série ${i + 1}</span><span class="w">${fmtKg(s.w)} × ${s.r}</span></li>`)
        .join('');
      return `<h3 style="margin-top:16px; font-size:17px;">${esc(e.name)}</h3><ul class="history-lines">${rows}</ul>`;
    })
    .join('');
  openSheet(`
    <h3>${esc(fmtDateLong(w.date))}</h3>
    ${sections}
    <button class="btn destructive" data-action="delete-workout" data-id="${esc(w.id)}" style="margin-top:20px;">Smazat trénink</button>
  `);
}

// --- Statistiky ---
function statsData(exId) {
  const points = [];
  workouts.forEach((w) => {
    const entry = w.entries.find((e) => e.exId === exId && e.sets.length);
    if (entry) points.push({ date: w.date, w: Math.max(...entry.sets.map((s) => s.w)) });
  });
  return points;
}

function viewStats() {
  if (!statsExId || !findExercise(statsExId)) {
    statsExId = (exercises.find((e) => statsData(e.id).length) || exercises[0] || {}).id || null;
  }
  let html = `<h1>Statistiky</h1><p class="subtitle">Vývoj váhy v čase</p>`;

  if (!exercises.length) return html + `<div class="empty"><span class="big">🤷</span>Nejdřív si přidej cviky.</div>`;

  html += `<div class="chips">${exercises
    .map((e) => `<button class="chip ${e.id === statsExId ? 'active' : ''}" data-action="pick-stats" data-id="${esc(e.id)}">${esc(e.name)}</button>`)
    .join('')}</div>`;

  const ex = findExercise(statsExId);
  const points = statsData(statsExId);

  if (points.length === 0) {
    return html + `<div class="empty"><span class="big">📈</span>Pro cvik <b>${esc(ex.name)}</b> zatím nejsou žádná data.<br>Zaznamenej trénink a graf se vykreslí.</div>`;
  }

  const pr = Math.max(...points.map((p) => p.w));
  const lastW = points[points.length - 1].w;
  const firstW = points[0].w;
  const diff = lastW - firstW;

  html += `
    <div class="stat-tiles">
      <div class="stat-tile"><div class="v">${fmtKg(pr)}</div><div class="l">Osobní rekord</div></div>
      <div class="stat-tile"><div class="v">${fmtKg(lastW)}</div><div class="l">Poslední váha</div></div>
      <div class="stat-tile"><div class="v">${diff >= 0 ? '+' : ''}${fmtNum(diff)} kg</div><div class="l">Celkový posun</div></div>
    </div>`;

  if (points.length < 2) {
    html += `<div class="card"><p class="hint" style="margin:0;">Zaznamenej alespoň dva tréninky s tímto cvikem a uvidíš graf progrese.</p></div>`;
  } else {
    const sel = statsPointIdx != null && points[statsPointIdx] ? points[statsPointIdx] : null;
    html += `
      <div class="card">
        <div class="chart-wrap">${chartSVG(points, statsPointIdx)}</div>
        <div class="chart-caption">${
          sel ? `${esc(fmtDate(sel.date, { day: 'numeric', month: 'numeric', year: 'numeric' }))} — ${fmtKg(sel.w)}` : 'Klepni na bod pro detail'
        }</div>
      </div>`;
  }

  const tableRows = [...points]
    .reverse()
    .slice(0, 12)
    .map((p) => `<li><span>${esc(fmtDate(p.date, { weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric' }))}</span><span class="w">${fmtKg(p.w)}</span></li>`)
    .join('');
  html += `<h2>Záznamy</h2><div class="card"><ul class="history-lines" style="margin:0;">${tableRows}</ul></div>`;
  return html;
}

/** Jednoduchý čárový graf v SVG (bez závislostí). */
function chartSVG(points, selectedIdx) {
  const W = 340, H = 190;
  const padL = 40, padR = 14, padT = 14, padB = 26;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  let min = Math.min(...points.map((p) => p.w));
  let max = Math.max(...points.map((p) => p.w));
  if (min === max) { min -= 5; max += 5; }
  const range = max - min;
  min = Math.floor((min - range * 0.1) / 2.5) * 2.5;
  max = Math.ceil((max + range * 0.1) / 2.5) * 2.5;

  const x = (i) => padL + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v) => padT + innerH - ((v - min) / (max - min)) * innerH;

  // vodicí linky (nenápadné) + popisky osy Y
  const gridCount = 4;
  let grid = '';
  for (let g = 0; g <= gridCount; g++) {
    const v = min + ((max - min) * g) / gridCount;
    const gy = y(v);
    grid += `<line x1="${padL}" y1="${gy}" x2="${W - padR}" y2="${gy}" stroke="var(--sep)" stroke-width="1"/>`;
    grid += `<text x="${padL - 6}" y="${gy + 3}" text-anchor="end" font-size="10" fill="var(--text2)">${fmtNum(v)}</text>`;
  }

  // popisky osy X: první, prostřední, poslední datum
  const labelIdx = points.length > 2 ? [0, Math.floor((points.length - 1) / 2), points.length - 1] : [0, points.length - 1];
  let xlabels = '';
  [...new Set(labelIdx)].forEach((i) => {
    const anchor = i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle';
    xlabels += `<text x="${x(i)}" y="${H - 8}" text-anchor="${anchor}" font-size="10" fill="var(--text2)">${esc(
      fmtDate(points[i].date, { day: 'numeric', month: 'numeric' })
    )}</text>`;
  });

  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.w).toFixed(1)}`).join(' ');

  // body: 2px kroužek v barvě podkladu, aby se oddělily od čáry
  let dots = '';
  points.forEach((p, i) => {
    const sel = i === selectedIdx;
    dots += `<g data-action="pick-point" data-idx="${i}" style="cursor:pointer;">
      <circle cx="${x(i).toFixed(1)}" cy="${y(p.w).toFixed(1)}" r="14" fill="transparent"/>
      <circle cx="${x(i).toFixed(1)}" cy="${y(p.w).toFixed(1)}" r="${sel ? 6 : 4}" fill="var(--accent)" stroke="var(--card)" stroke-width="2"/>
    </g>`;
  });

  // přímý popisek posledního bodu (selektivně — ne u každého bodu)
  const li = points.length - 1;
  const lastLabel = `<text x="${(x(li) - 6).toFixed(1)}" y="${(y(points[li].w) - 10).toFixed(1)}" text-anchor="end" font-size="11" font-weight="600" fill="var(--text)">${fmtNum(points[li].w)} kg</text>`;

  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Graf vývoje váhy">
    ${grid}${xlabels}
    <path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}${lastLabel}
  </svg>`;
}

// --- Cviky a nastavení ---
function viewExercises() {
  let html = `<h1>Cviky</h1><p class="subtitle">${exercises.length} cviků v databázi</p>`;

  exercises.forEach((e) => {
    const last = lastEntryFor(e.id);
    const lastW = last ? Math.max(...last.entry.sets.map((s) => Number(s.w) || 0)) : null;
    html += `
      <button class="ex-row" data-action="edit-exercise" data-id="${esc(e.id)}">
        <span class="name">${esc(e.name)}<span class="badge-group">${groupLabel(e.group)}</span></span>
        <span class="meta">${e.sets}×${e.reps}${lastW ? '<br>' + fmtKg(lastW) : ''}</span>
        <span class="chevron">›</span>
      </button>`;
  });

  html += `<button class="btn secondary" data-action="new-exercise" style="margin-top:10px;">＋ Přidat vlastní cvik</button>`;

  html += `
    <h2>Nastavení</h2>
    <div class="card">
      <div class="settings-row">
        <span>Pauza mezi sériemi<span class="desc">v sekundách</span></span>
        <input type="number" inputmode="numeric" min="10" max="600" step="5" value="${settings.rest}" data-field="rest">
      </div>
      <div class="settings-row">
        <span>Záloha dat<span class="desc">export/import do souboru JSON</span></span>
        <span style="display:flex; gap:8px;">
          <button class="small-btn" data-action="export" style="flex:none; padding: 9px 14px;">Export</button>
          <button class="small-btn" data-action="import" style="flex:none; padding: 9px 14px;">Import</button>
        </span>
      </div>
    </div>
    <p class="hint" style="text-align:center; margin-top:16px;">Posilka · data jsou uložena jen v tomto zařízení</p>`;
  return html;
}

function exerciseFormSheet(ex) {
  const isNew = !ex;
  const e = ex || { name: '', group: 'upper', sets: 5, reps: 5 };
  openSheet(`
    <h3>${isNew ? 'Nový cvik' : 'Upravit cvik'}</h3>
    <div class="form-row">
      <label for="f-name">Název</label>
      <input type="text" id="f-name" value="${esc(e.name)}" placeholder="např. Biceps s jednoručkami" autocomplete="off">
    </div>
    <div class="form-row">
      <label>Partie (určuje přírůstek váhy)</label>
      <div class="segmented" id="f-group">
        <button type="button" data-group="upper" class="${e.group === 'upper' ? 'active' : ''}">Vršek (+2,5 kg)</button>
        <button type="button" data-group="lower" class="${e.group === 'lower' ? 'active' : ''}">Spodek (+5 kg)</button>
      </div>
    </div>
    <div class="form-cols">
      <div class="form-row">
        <label for="f-sets">Cílové série</label>
        <input type="number" id="f-sets" inputmode="numeric" min="1" max="12" value="${e.sets}">
      </div>
      <div class="form-row">
        <label for="f-reps">Cílová opakování</label>
        <input type="number" id="f-reps" inputmode="numeric" min="1" max="50" value="${e.reps}">
      </div>
    </div>
    <button class="btn" data-action="save-exercise" data-id="${isNew ? '' : esc(e.id)}" style="margin-top:8px;">Uložit</button>
    ${isNew ? '' : `<button class="btn destructive" data-action="delete-exercise" data-id="${esc(e.id)}">Smazat cvik</button>`}
  `);
  const seg = document.getElementById('f-group');
  seg.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-group]');
    if (!b) return;
    seg.querySelectorAll('button').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
  });
}

function saveExerciseFromSheet(id) {
  const name = document.getElementById('f-name').value.trim();
  if (!name) {
    alert('Zadej název cviku.');
    return;
  }
  const group = document.querySelector('#f-group button.active')?.dataset.group || 'upper';
  const sets = Math.min(12, Math.max(1, parseInt(document.getElementById('f-sets').value, 10) || 5));
  const reps = Math.min(50, Math.max(1, parseInt(document.getElementById('f-reps').value, 10) || 5));

  if (id) {
    const ex = findExercise(id);
    if (ex) Object.assign(ex, { name, group, sets, reps });
  } else {
    exercises.push({ id: uid(), name, group, sets, reps, custom: true });
  }
  saveExercises();
  closeSheet();
  render();
}

function deleteExercise(id) {
  if (!confirm('Smazat cvik? Historie tréninků zůstane zachována.')) return;
  exercises = exercises.filter((e) => e.id !== id);
  saveExercises();
  closeSheet();
  render();
}

// --- Výběr cviku do tréninku ---
function openAddExerciseSheet() {
  const inWorkout = new Set(current.entries.map((e) => e.exId));
  const items = exercises
    .filter((e) => !inWorkout.has(e.id))
    .map((e) => {
      const sug = suggestion(e);
      const badge = sug
        ? `<span class="sugg ${sug.met ? 'up' : ''}">${sug.met ? '↑ ' : ''}${fmtKg(sug.next)}</span>`
        : `<span class="badge">nový</span>`;
      return `<button class="sheet-list-item" data-action="add-to-workout" data-id="${esc(e.id)}">
        <span class="name">${esc(e.name)}</span>
        <span class="badge">${e.sets}×${e.reps}</span>
        ${badge}
      </button>`;
    })
    .join('');
  openSheet(`
    <h3>Přidat cvik</h3>
    ${items || '<p class="hint">Všechny cviky už v tréninku máš.</p>'}
    <button class="btn ghost" data-action="new-exercise" style="margin-top:8px;">＋ Vytvořit nový cvik</button>
  `);
}

// ---------- Bottom sheet ----------
function openSheet(html) {
  const backdrop = document.getElementById('sheet');
  document.getElementById('sheet-body').innerHTML = html;
  backdrop.hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => backdrop.classList.add('open')));
}

function closeSheet() {
  const backdrop = document.getElementById('sheet');
  if (backdrop.hidden) return;
  backdrop.classList.remove('open');
  setTimeout(() => { backdrop.hidden = true; }, 300);
}

// ---------- Export / import ----------
function exportData() {
  const data = { app: 'posilka', version: 1, exported: new Date().toISOString(), exercises, workouts, settings };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `posilka-zaloha-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || !Array.isArray(data.exercises) || !Array.isArray(data.workouts)) throw new Error('bad format');
      if (!confirm(`Nahradit aktuální data zálohou z ${data.exported ? fmtDate(data.exported, { day: 'numeric', month: 'numeric', year: 'numeric' }) : '?'}? (${data.workouts.length} tréninků)`)) return;
      exercises = data.exercises;
      workouts = data.workouts;
      settings = Object.assign({ rest: 90 }, data.settings || {});
      saveExercises(); saveWorkouts(); saveSettings();
      render();
      alert('Data byla obnovena.');
    } catch {
      alert('Soubor se nepodařilo načíst — není to platná záloha Posilky.');
    }
  };
  reader.readAsText(file);
}

// ---------- Události ----------
document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el) {
    // klepnutí na pozadí sheetu ho zavře
    if (ev.target.id === 'sheet') closeSheet();
    return;
  }
  const a = el.dataset.action;
  const ei = el.dataset.ei != null ? Number(el.dataset.ei) : null;
  const si = el.dataset.si != null ? Number(el.dataset.si) : null;
  const id = el.dataset.id;

  switch (a) {
    case 'start-workout': startWorkout(); break;
    case 'open-add-exercise': openAddExerciseSheet(); break;
    case 'add-to-workout': addExerciseToWorkout(id); break;
    case 'toggle-set': toggleSet(ei, si); break;
    case 'add-set': addSet(ei); break;
    case 'remove-set': removeSet(ei); break;
    case 'remove-entry': removeEntry(ei); break;
    case 'finish-workout': finishWorkout(); break;
    case 'cancel-workout': cancelWorkout(); break;
    case 'open-workout': openWorkoutDetail(id); break;
    case 'delete-workout': deleteWorkout(id); break;
    case 'pick-stats': statsExId = id; statsPointIdx = null; render(); break;
    case 'pick-point': statsPointIdx = Number(el.dataset.idx); render(); break;
    case 'new-exercise': exerciseFormSheet(null); break;
    case 'edit-exercise': exerciseFormSheet(findExercise(id)); break;
    case 'save-exercise': saveExerciseFromSheet(id || null); break;
    case 'delete-exercise': deleteExercise(id); break;
    case 'rest-add': addRestTime(15); break;
    case 'rest-stop': stopRest(); break;
    case 'dismiss-install': store.set('hideInstall', true); render(); break;
    case 'export': exportData(); break;
    case 'import': document.getElementById('import-file').click(); break;
  }
});

// změny vstupů (váha, opakování, nastavení)
document.getElementById('view').addEventListener('input', (ev) => {
  const input = ev.target;
  const field = input.dataset.field;
  if (!field) return;

  if (field === 'w' || field === 'r') {
    const entry = current && current.entries[Number(input.dataset.ei)];
    const set = entry && entry.sets[Number(input.dataset.si)];
    if (!set) return;
    const v = input.value === '' ? '' : Number(input.value);
    set[field] = v;
    saveCurrent();
  } else if (field === 'rest') {
    const v = parseInt(input.value, 10);
    if (v >= 10 && v <= 600) {
      settings.rest = v;
      saveSettings();
    }
  }
});

// přepínání záložek
document.querySelectorAll('.tab').forEach((b) =>
  b.addEventListener('click', () => {
    activeTab = b.dataset.tab;
    closeSheet();
    render();
  })
);

// import souboru
document.getElementById('import-file').addEventListener('change', (ev) => {
  const file = ev.target.files[0];
  if (file) importData(file);
  ev.target.value = '';
});

// ---------- Start ----------
render();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline režim nedostupný */ });
  });
}
