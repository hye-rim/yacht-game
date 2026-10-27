'use strict';
// 오락실 튜토리얼이 '진짜로 일어난 일'을 알아채는 신호 (arcade/public/tutorial.js 가 듣는다. 튜토리얼이 아니면 아무도 안 듣는다)
const tutorialSignal = (type) => window.dispatchEvent(new CustomEvent('arcade:tutorial', { detail: { type } }));

// 요트 다이스: 화면·입력·소리·온라인. 규칙과 컴퓨터는 logic.js (LOGIC_YACHT), 방·매칭·주사위 굴리기는 server.js
(() => {
const L = LOGIC_YACHT;
const $ = (id) => document.getElementById(id);
const T = { cpu: 700, roll: 520, over: 900 };                // 시간(ms). 시험용으로 줄일 수 있다
const SHORT = ['1의 눈', '2의 눈', '3의 눈', '4의 눈', '5의 눈', '6의 눈', '초이스', '포카드', '풀하우스', '스몰 ST', '라지 ST', '요트'];
const PIPS = [[], [4], [0, 8], [0, 4, 8], [0, 2, 6, 8], [0, 2, 4, 6, 8], [0, 2, 3, 5, 6, 8]];

// ---------- 저장소 ----------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};
let wins = Number(store.get('yachtWins')) || 0;
const ONLINE_KEY = 'yachtOnline', SESSION_KEY = 'yachtSession';
const loadJson = (k) => { try { return JSON.parse(store.get(k)) || {}; } catch (_) { return {}; } };
function loadSession() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch (_) { return null; } }
function saveSession(s) { try { s ? sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)) : sessionStorage.removeItem(SESSION_KEY); } catch (_) {} }
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const myName = () => store.get('yachtName') || '';

// ---------- 소리 ----------
let audio = null;
let muted = store.get('yachtMuted') === '1';
function tone(freq, dur, type = 'sine', vol = 0.09, slide = 0) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(audio.destination);
    o.start(t);
    o.stop(t + dur);
  } catch (_) {}
}
const seq = (notes, step, type = 'triangle', vol = 0.09) => notes.forEach((f, i) => setTimeout(() => tone(f, step * 0.0009, type, vol), i * step));
const sfx = {
  roll: () => seq([300, 240, 330, 260, 360, 300], 60, 'square', 0.04),
  hold: () => tone(520, 0.05, 'triangle', 0.08),
  pick: () => tone(440, 0.05, 'triangle', 0.07),
  score: () => seq([523, 659], 80, 'triangle', 0.09),
  big: () => seq([523, 659, 784, 1047], 90, 'triangle', 0.1),
  zero: () => tone(200, 0.12, 'square', 0.05),
  bad: () => tone(150, 0.1, 'square', 0.05),
  found: () => seq([392, 523], 90, 'triangle', 0.08),
  win: () => seq([523, 659, 784, 1047], 110, 'triangle', 0.1),
  lose: () => seq([392, 330, 262, 196], 150, 'sawtooth', 0.06),
};
function toggleMute() { muted = !muted; store.set('yachtMuted', muted ? '1' : '0'); $('muteBtn').textContent = muted ? '🔇' : '🔊'; }
$('muteBtn').onclick = (e) => { e.currentTarget.blur(); toggleMute(); };
$('muteBtn').textContent = muted ? '🔇' : '🔊';

// ---------- 상태 ----------
let mode = 'easy';                  // 'easy' · 'hard' (컴퓨터) · 'online'
let phase = 'title';                // title · play · over
let st = null;                      // 컴퓨터 대전 판 (나는 0번, 먼저)
let room = null, view = null, waitingNet = false, netDown = false, turnEnd = 0, recorded = '', seenMove = 0;
let cpuTimer = 0, overTimer = 0, thinking = false;
let sel = null;                     // 점수를 적으려고 고른 칸
let rollUntil = 0, rollTimer = 0;   // 주사위 굴리는 연출이 끝나는 때
const online = () => mode === 'online';

// 화면에 그릴 모양: { s: 판(규칙 상태), you, turn, state, winner, reason, last, names }
function model() {
  if (online()) {
    if (!room || !view) return null;
    return { s: view, you: room.you, turn: room.turn, state: room.state, winner: room.winner, reason: room.reason, last: room.lastMove,
      names: [0, 1].map((c) => (c === room.you ? '나' : ((room.players.find((p) => p.color === c) || {}).name || '상대'))) };
  }
  if (!st) return null;
  return { s: st, you: 0, turn: st.turn, state: st.over ? 'over' : 'playing', winner: st.winner, reason: st.over ? 'done' : '', last: st.last, names: ['나', '컴퓨터'] };
}
function stateFromRoom(r) {
  const g = L.newGame();
  g.dice = r.dice.slice(); g.held = r.held.slice(); g.rollsLeft = r.rollsLeft; g.cards = r.cards.map((c) => c.slice()); g.turn = r.turn;
  g.over = r.state === 'over' && r.reason === 'done'; g.winner = g.over ? r.winner : -1;
  return g;
}
const rolling = () => performance.now() < rollUntil;
const myTurn = (m) => !!m && m.state === 'playing' && m.turn === m.you && !netDown && !thinking;
const canAct = (m) => myTurn(m) && !waitingNet && !rolling();

// ---------- 그리기 ----------
function dieHtml(v, held, blank, mine, shake, i) {
  const pips = PIPS[v] || [];
  let cells = '';
  for (let k = 0; k < 9; k++) cells += `<i class="${pips.includes(k) ? 'p' : ''}"></i>`;
  return `<div class="die${blank ? ' blank' : ''}${held ? ' held' : ''}${mine ? ' mine' : ''}${shake ? ' shake' : ''}" data-i="${i}">${cells}</div>`;
}
function renderDice(m) {
  const g = m.s;
  const anim = rolling();
  let html = '';
  for (let i = 0; i < 5; i++) {
    const unrolled = !L.rolled(g);
    const shake = anim && !g.held[i];
    const v = shake ? 1 + Math.floor(Math.random() * 6) : g.dice[i];
    const canHold = canAct(m) && L.rolled(g) && g.rollsLeft > 0;
    html += dieHtml(v, g.held[i] && !unrolled, unrolled || !v, canHold, shake, i);
  }
  $('dice').innerHTML = html;
}
function renderSheet(m) {
  const g = m.s, me = m.you, op = 1 - m.you;
  const mineNow = canAct(m) && L.rolled(g);
  const last = m.last && m.last.who !== me ? m.last : null;       // 상대가 방금 적은 칸
  const cell = (p, k) => {
    const v = g.cards[p][k];
    if (v !== null) return `<span class="c ${p === me ? 'me' : 'op'}${last && p === last.who && k === last.cat ? ' lastop' : ''}">${v}</span>`;
    if (p === me && mineNow) return `<span class="c me"><span class="pot">${L.score(k, g.dice)}</span></span>`;
    return `<span class="c ${p === me ? 'me' : 'op'}"></span>`;
  };
  const row = (k) => {
    const open = g.cards[me][k] === null;
    return `<div class="ln cat${open ? ' open' : ''}${open && mineNow ? ' mine' : ''}${sel === k && mineNow ? ' sel' : ''}" data-cat="${k}"><span class="nm">${SHORT[k]}</span>${cell(me, k)}${cell(op, k)}</div>`;
  };
  const head = `<div class="ln head"><span class="nm"></span><span class="c me${m.state === 'playing' && m.turn === me ? ' on' : ''}">나</span><span class="c op${m.state === 'playing' && m.turn === op ? ' on' : ''}">${esc(m.names[op]).slice(0, 4)}</span></div>`;
  const upper = (p) => L.upperSum(g.cards[p]);
  const bon = (p) => (upper(p) >= L.BONUS_AT ? `<span class="c bon">+${L.BONUS}</span>` : `<span class="c">${upper(p)}</span>`);
  const left = head + [0, 1, 2, 3, 4, 5].map(row).join('') +
    `<div class="ln foot"><span class="nm">보너스 63↑</span><span class="c me">${bon(me).replace('class="c ', 'class="c ')}</span><span class="c op">${bon(op)}</span></div>`;
  const right = head + [6, 7, 8, 9, 10, 11].map(row).join('') +
    `<div class="ln foot tot"><span class="nm">합계</span><span class="c me"><b>${L.total(g.cards[me])}</b></span><span class="c op"><b>${L.total(g.cards[op])}</b></span></div>`;
  $('sheet').innerHTML = `<div class="blk">${left}</div><div class="blk">${right}</div>`;
}
function render() {
  const m = model();
  if (!m) { renderHud(null); return; }
  if (sel !== null && (!canAct(m) || !L.rolled(m.s) || m.s.cards[m.you][sel] !== null)) sel = null;
  renderSheet(m);
  renderDice(m);
  const g = m.s, mineNow = canAct(m);
  const left = g.rollsLeft;
  $('rollBtn').disabled = !(mineNow && left > 0 && !g.held.every(Boolean) || (mineNow && !L.rolled(g)));
  $('rollBtn').innerHTML = !L.rolled(g) ? '🎲 굴리기' : `🎲 다시 굴리기${left > 0 ? `<small>(${left}번)</small>` : ''}`;
  $('okBtn').disabled = !(mineNow && L.rolled(g) && sel !== null);
  $('okBtn').textContent = sel !== null && mineNow ? `✔ ${SHORT[sel]} ${L.score(sel, g.dice)}점` : '✔ 적기';
  renderHud(m);
}
function renderHud(m = model()) {
  $('wins').textContent = wins.toLocaleString('ko-KR');
  let text = '요트 다이스';
  if (m && phase === 'play' && m.state === 'playing') {
    const sec = Math.max(0, Math.ceil((turnEnd - performance.now()) / 1000));
    const rd = `${12 - L.openCats(m.s, m.turn).length + 1}/12`;
    if (online() && netDown) text = '연결 다시 붙이는 중…';
    else if (m.turn === m.you) text = `내 차례 ${rd}${online() ? ` · ${sec}초` : ''}`;
    else text = online() ? `${m.names[m.turn]} 차례 · ${sec}초` : '컴퓨터 차례…';
  }
  $('turn').textContent = text;
  $('resignBtn').style.display = online() && room && room.state === 'playing' ? '' : 'none';
}
function say(t) { $('msg').textContent = t; }

// 굴리는 연출: 안 고정된 주사위가 흔들리다 멈춘다
function animateRoll() {
  sfx.roll();
  rollUntil = performance.now() + T.roll;
  clearInterval(rollTimer);
  rollTimer = setInterval(() => {
    const m = model();
    if (!m) return;
    if (!rolling()) { clearInterval(rollTimer); render(); return; }
    renderDice(m);
  }, 70);
  render();
}

// ---------- 창 ----------
const overlayOpen = () => !$('overlay').classList.contains('hidden');
function showOverlay(html) { $('overlay').innerHTML = html; $('overlay').classList.remove('hidden'); }
function hideOverlay() { $('overlay').classList.add('hidden'); }

// ---------- 입력 ----------
$('dice').addEventListener('pointerdown', (e) => {
  const d = e.target.closest('.die');
  if (!d) return;
  e.preventDefault();
  const m = model();
  if (!canAct(m) || !L.rolled(m.s) || m.s.rollsLeft <= 0) { if (m && m.turn === m.you) sfx.bad(); return; }
  const i = Number(d.dataset.i);
  if (online()) {
    const mask = m.s.held.slice(); mask[i] = !mask[i];
    view.held = mask; sfx.hold(); render();
    net.send('hold', { mask });
    if (mask[i]) tutorialSignal('hold');
    return;
  }
  if (!L.toggleHold(st, i)) return;
  sfx.hold(); render();
  if (st.held[i]) tutorialSignal('hold');
});
$('sheet').addEventListener('pointerdown', (e) => {
  const rowEl = e.target.closest('.ln.cat');
  if (!rowEl) return;
  const m = model();
  const k = Number(rowEl.dataset.cat);
  if (!canAct(m) || !L.rolled(m.s) || m.s.cards[m.you][k] !== null) { if (m && m.turn === m.you && L.rolled(m.s)) sfx.bad(); return; }
  e.preventDefault();
  if (sel === k) { sel = null; render(); return; }
  sel = k; sfx.pick(); render();
  tutorialSignal('pick');
});
$('rollBtn').onclick = (e) => { e.currentTarget.blur(); doRoll(); };
$('okBtn').onclick = (e) => { e.currentTarget.blur(); if (sel !== null) doScore(sel); };
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'KeyM') toggleMute();
  if (e.code === 'Space' && phase === 'play' && !overlayOpen() && !$('rollBtn').disabled) { e.preventDefault(); doRoll(); }
});

function doRoll() {
  const m = model();
  if (!canAct(m) || m.s.rollsLeft <= 0) return;
  if (online()) { waitingNet = true; net.send('roll'); render(); return; }
  if (!L.rollDice(st)) return;
  sel = null;
  animateRoll();
  tutorialSignal('roll');
}
function doScore(k) {
  const m = model();
  if (!canAct(m) || !L.rolled(m.s) || m.s.cards[m.you][k] !== null) return;
  if (online()) { waitingNet = true; sel = null; net.send('score', { cat: k }); render(); return; }
  const res = L.scoreCat(st, k);
  if (!res) return;
  sel = null;
  announce(res);
  tutorialSignal('score');
  render();
  if (res.over) { overTimer = setTimeout(showOver, T.over); return; }
  scheduleCpu();
}
function announce(res) {
  const m = model();
  const mine = res.who === m.you;
  const nm = SHORT[res.cat];
  if (res.pts >= 30) sfx.big(); else if (res.pts === 0) sfx.zero(); else sfx.score();
  say(`${mine ? '내가' : '상대가'} ${nm}에 ${res.pts}점을 적었어요${res.pts === 0 ? ' (0점)' : res.pts === 50 ? ' 🎉 요트!' : ''}`);
}

// ---------- 컴퓨터 대전 ----------
function startCpu(level) {
  leaveOnline();
  clearTimeout(cpuTimer); clearTimeout(overTimer);
  mode = level; st = L.newGame(); phase = 'play'; sel = null; thinking = false; turnEnd = 0; rollUntil = 0;
  hideOverlay(); render();
  say('🎲 굴리기로 시작해요!\n주사위를 눌러 남기고, 점수 칸을 골라 ✔ 적기');
}
function scheduleCpu() { thinking = true; render(); cpuTimer = setTimeout(cpuTurn, T.cpu); }
function cpuTurn() {
  if (phase !== 'play' || !st || online() || st.over || st.turn !== 1) { thinking = false; render(); return; }
  const act = mode === 'hard' ? L.aiPick(st, 'hard') : L.aiPick(st, 'easy');
  if (act.type === 'roll') {
    if (L.rolled(st)) { L.setHold(st, act.hold); render(); cpuTimer = setTimeout(() => cpuRoll(), T.cpu); }
    else cpuRoll();
  } else {
    sel = act.cat;                              // 고른 칸을 잠깐 보여 준다
    cpuTimer = setTimeout(() => {
      sel = null;
      const res = L.scoreCat(st, act.cat);
      thinking = false;
      if (res) announce(res);
      render();
      if (res && res.over) overTimer = setTimeout(showOver, T.over);
    }, T.cpu);
  }
}
function cpuRoll() {
  if (phase !== 'play' || !st || st.over) return;
  L.rollDice(st);
  animateRoll();
  cpuTimer = setTimeout(cpuTurn, T.roll + T.cpu);
}
function showOver() {
  phase = 'over';
  const a = L.total(st.cards[0]), b = L.total(st.cards[1]);
  const youWon = st.winner === 0, draw = st.winner === 2;
  if (youWon) { wins++; store.set('yachtWins', String(wins)); sfx.win(); } else if (draw) sfx.found(); else sfx.lose();
  const best = Number(store.get('yachtBest')) || 0;
  if (a > best) store.set('yachtBest', String(a));
  showOverlay(`
    <h2>${draw ? '비겼어요! 🤝' : youWon ? '이겼어요! 🎉' : '아쉬워요! 😵'}</h2>
    <dl class="stats card2"><dt>나</dt><dd>${a}점${L.bonus(st.cards[0]) ? ' (보너스 +35)' : ''}</dd><dt>컴퓨터</dt><dd>${b}점${L.bonus(st.cards[1]) ? ' (보너스 +35)' : ''}</dd><dt>내 최고 점수</dt><dd>${Math.max(a, best)}점</dd></dl>
    <p>컴퓨터 상대 승리 <b>${wins}</b>번</p>
    <div class="col"><button data-act="again">다시 하기</button><button class="sub" data-act="view">점수표 보기</button><button class="sub" data-act="home">처음으로</button></div>`);
  render();
}
function showTitle() {
  leaveOnline();
  clearTimeout(cpuTimer); clearTimeout(overTimer);
  mode = 'easy'; phase = 'title'; st = L.newGame(); sel = null; thinking = false; rollUntil = 0;
  say(''); render();
  const on = loadJson(ONLINE_KEY);
  showOverlay(`
    <h1>요트 다이스</h1>
    <p>주사위 5개로 <b>족보</b>를 채워 점수를 겨뤄요!</p>
    <div class="card2" style="font-size:13px">한 차례에 <b>최대 3번</b> 굴려요<br>마음에 드는 주사위는 눌러서 <b>고정</b>해 두고 나머지만 다시!<br>12칸에 한 번씩만 적을 수 있어요 (0점도 적어야 해요)<br>1~6의 눈 합이 <b>63점 이상</b>이면 보너스 <b>+35</b></div>
    <div class="col"><button data-act="cpu" data-lv="easy">🤖 컴퓨터랑 · 쉬움</button><button class="sub" data-act="cpu" data-lv="hard">🤖 컴퓨터랑 · 어려움</button><button class="sub" data-act="online">🌐 온라인 대전${on.w || on.l ? ` · ${on.w || 0}승 ${on.l || 0}패` : ''}</button></div>`);
}

// ---------- 온라인: 연결 ----------
const net = {
  ws: null, pulse: null, outbox: [], retry: 0,
  connect() {
    if (this.ws && this.ws.readyState <= 1) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}${location.pathname}`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.raw('hello', { name: myName() });
      const s = loadSession();
      if (s) this.raw('resume', s);
      for (const [t, p] of this.outbox.splice(0)) this.raw(t, p);
      clearInterval(this.pulse);
      this.pulse = setInterval(() => this.raw('pulse'), 10000);
    };
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (_) { return; } onNet(m); };
    ws.onclose = () => {
      clearInterval(this.pulse);
      if (this.ws !== ws) return;
      this.ws = null;
      if (!online()) return;
      if (room || loadSession()) {
        netDown = true; waitingNet = false; render();
        setTimeout(() => { if (online()) this.connect(); }, Math.min(4000, 500 * 2 ** this.retry++));
      } else showOnline('서버와 연결이 끊겼어요. 다시 시도해 주세요.');
    };
  },
  send(t, p = {}) {
    if (this.ws && this.ws.readyState === 1) this.raw(t, p);
    else { this.outbox.push([t, p]); this.connect(); }
  },
  raw(t, p = {}) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ t, ...p })); },
  close() {
    const ws = this.ws;
    this.ws = null; this.outbox = [];
    clearInterval(this.pulse);
    if (ws) ws.close();
  },
};

function onNet(m) {
  if (m.t === 'queued') showQueued();
  else if (m.t === 'room') applyRoom(m);
  else if (m.t === 'error') { room = null; saveSession(null); showOnline(m.msg); }
  else if (m.t === 'resumeFailed') {
    saveSession(null);
    if (room) { room = null; showOnline('대국이 끝나서 이어갈 수 없어요.'); }
    netDown = false; render();
  }
}

function leaveOnline() {
  if (!online()) return;
  net.send('leave'); net.close();
  saveSession(null);
  room = null; view = null; netDown = false; waitingNet = false; mode = 'easy'; phase = 'title';
}

// ---------- 온라인: 대국 ----------
function applyRoom(r) {
  const prev = room;
  const fresh = !prev || prev.code !== r.code;
  const newGame = fresh || prev.games !== r.games;
  room = r;
  view = stateFromRoom(r);
  netDown = false; waitingNet = false;
  saveSession({ code: r.code, token: r.token });
  turnEnd = performance.now() + r.remain;
  if (newGame) { seenMove = r.lastMove ? r.lastMove.seq : 0; sel = null; rollUntil = 0; say(''); }
  if (r.state === 'waiting') { phase = 'title'; showWaiting(); render(); return; }
  phase = r.state === 'playing' ? 'play' : 'over';
  if (newGame && r.state === 'playing') { sfx.found(); say(r.turn === r.you ? '내가 먼저예요! 🎲 굴려요' : '상대가 먼저 굴려요'); }
  if (!($('overlay').dataset.screen === 'confirm') && r.state !== 'over') hideOverlay();
  // 굴림이 일어났으면(내 것이든 상대 것이든) 주사위가 흔들리는 연출
  const rolledNow = !newGame && prev && prev.turn === r.turn && r.rollsLeft < prev.rollsLeft;
  const lm = r.lastMove;
  if (lm && lm.seq > seenMove && !newGame) {
    seenMove = lm.seq;
    announce(lm);
  }
  if (rolledNow) animateRoll(); else render();
  if (r.state === 'over') afterOver();
}
function afterOver() {
  const r = room;
  const key = `${r.code}:${r.games}:${r.reason}:${r.winner}`;
  if (recorded !== key) {
    recorded = key;
    const rec = loadJson(ONLINE_KEY);
    if (r.winner === r.you) { rec.w = (rec.w || 0) + 1; sfx.win(); } else if (r.winner === 2) sfx.found(); else { rec.l = (rec.l || 0) + 1; sfx.lose(); }
    store.set(ONLINE_KEY, JSON.stringify(rec));
    setTimeout(() => { if (room && room.state === 'over') showResult(); }, T.over);
  } else if (overlayOpen()) showResult();
}

function showResult() {
  const r = room;
  const won = r.winner === r.you, draw = r.winner === 2;
  const a = L.total(r.cards[r.you]), b = L.total(r.cards[1 - r.you]);
  const why = {
    done: draw ? '점수가 같아요' : won ? '내 점수가 더 높아요!' : '상대 점수가 더 높아요',
    resign: won ? '상대가 기권했어요' : '기권했어요',
    timeout: won ? '상대가 시간을 넘겼어요' : '시간을 넘겼어요',
    left: won ? '상대가 나갔어요' : '연결이 끊겨 패배했어요',
  }[r.reason] || '';
  const rec = loadJson(ONLINE_KEY);
  const opp = r.players.find((p) => p.color !== r.you);
  const iVoted = r.rematch.includes(r.you), theyVoted = opp && r.rematch.includes(opp.color);
  let again;
  if (!opp) again = '<p>상대가 방을 나갔어요</p>';
  else if (iVoted) again = '<p>상대를 기다리는 중…</p>';
  else again = `${theyVoted ? '<p>상대가 한 판 더 하고 싶어해요!</p>' : ''}<button data-act="rematch">한 판 더</button>`;
  showOverlay(`
    <h2>${draw ? '🤝 무승부' : won ? '🎉 승리!' : '😵 패배'}</h2>
    ${why ? `<p>${esc(why)}</p>` : ''}
    ${r.reason === 'done' ? `<dl class="stats card2"><dt>나</dt><dd>${a}점</dd><dt>${esc((opp && opp.name) || '상대')}</dt><dd>${b}점</dd></dl>` : ''}
    <span class="tag">온라인 ${rec.w || 0}승 ${rec.l || 0}패</span>
    <div class="col">${again}
      <div class="row"><button class="sub" data-act="view">점수표 보기</button><button class="sub" data-act="leave">나가기</button></div>
    </div>`);
}

function showOnline(error = '') {
  leaveOnline();
  clearTimeout(cpuTimer); clearTimeout(overTimer);
  mode = 'online'; phase = 'title'; room = null; view = L.newGame(); st = null; waitingNet = false; sel = null; thinking = false; rollUntil = 0;
  say(''); render();
  showOverlay(`
    <h2>🌐 온라인 대전</h2>
    <input id="nameInput" maxlength="10" placeholder="내 이름 (최대 10자)" value="${esc(myName())}" autocomplete="off">
    <div class="col">
      <button data-act="quick">⚡ 빠른 대전</button>
      <button class="sub" data-act="create">방 만들기</button>
      <div class="row join"><input id="codeInput" maxlength="4" placeholder="방 코드" autocomplete="off" autocapitalize="characters"><button class="sub" data-act="join">들어가기</button></div>
    </div>
    <span class="error">${esc(error)}</span>
    <button class="back" data-act="home">← 처음으로</button>
    <p style="font-size:12.5px">한 차례에 60초 · 주사위는 서버가 굴려요 · 먼저 하는 쪽은 한 판마다 바뀌어요</p>`);
}
function showQueued() {
  showOverlay(`
    <h2>상대를 찾는 중…</h2>
    <div class="dots"><span></span><span></span><span></span></div>
    <p>누군가 빠른 대전을 누르면 바로 시작해요</p>
    <button class="sub" data-act="cancel">취소</button>`);
}
const inviteUrl = () => `${location.origin}${location.pathname}?room=${room.code}`;
function showWaiting() {
  showOverlay(`
    <h2>친구를 기다리는 중…</h2>
    <p>방 코드</p>
    <div class="code">${esc(room.code)}</div>
    <p>친구가 <b>온라인 대전 → 들어가기</b>에<br>이 코드를 넣으면 시작해요</p>
    <button data-act="copy">🔗 초대 링크 복사</button>
    <button class="sub" data-act="cancel">취소</button>`);
}
function saveName() {
  const input = $('nameInput');
  if (!input) return;
  const name = input.value.trim().slice(0, 10);
  store.set('yachtName', name);
  net.send('hello', { name });
}
function confirmResign() {
  showOverlay(`<h2>기권할까요?</h2><p>이번 판은 패배로 기록돼요</p>
    <div class="row"><button data-act="close">계속하기</button><button class="sub" data-act="resign">🏳 기권</button></div>`);
  $('overlay').dataset.screen = 'confirm';
}

let lastCpu = 'easy';
$('overlay').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  btn.blur();
  $('overlay').dataset.screen = '';
  const act = btn.dataset.act;
  if (act === 'cpu') { lastCpu = btn.dataset.lv; startCpu(lastCpu); }
  else if (act === 'again') startCpu(lastCpu);
  else if (act === 'home') showTitle();
  else if (act === 'online') showOnline();
  else if (act === 'quick') { saveName(); net.send('quick'); }
  else if (act === 'create') { saveName(); net.send('create'); }
  else if (act === 'join') {
    const code = ($('codeInput').value || '').trim().toUpperCase();
    if (code.length !== 4) { $('overlay').querySelector('.error').textContent = '방 코드 4자리를 넣어 주세요.'; return; }
    saveName();
    net.send('join', { code });
  } else if (act === 'cancel') { net.send('cancel'); showOnline(); }
  else if (act === 'copy') {
    const url = inviteUrl();
    const done = () => { btn.textContent = '✅ 복사했어요'; setTimeout(() => { btn.textContent = '🔗 초대 링크 복사'; }, 1500); };
    if (navigator.share && matchMedia('(pointer: coarse)').matches) navigator.share({ title: '요트 다이스 한 판 해요!', url }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => prompt('링크를 복사하세요', url));
    else prompt('링크를 복사하세요', url);
  } else if (act === 'rematch') { net.send('rematch'); }
  else if (act === 'view') hideOverlay();
  else if (act === 'leave') showOnline();
  else if (act === 'resign') { net.send('resign'); hideOverlay(); }
  else if (act === 'close') hideOverlay();
});
$('overlay').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (e.target.id === 'codeInput') $('overlay').querySelector('[data-act="join"]').click();
  if (e.target.id === 'nameInput') $('overlay').querySelector('[data-act="quick"]').click();
  e.stopPropagation();
});
$('resignBtn').onclick = (e) => { e.currentTarget.blur(); if (online() && room && room.state === 'playing') confirmResign(); };
setInterval(() => { if (online() && room && room.state === 'playing' && !netDown) renderHud(); }, 500);

// ---------- 시작 ----------
const invite = new URLSearchParams(location.search).get('room');
if (invite) { try { window.history.replaceState(null, '', location.pathname); } catch (_) {} }
function joinInvite(code) { showOnline(); net.send('join', { code: code.toUpperCase() }); }
if (loadSession()) {
  mode = 'online';
  view = L.newGame(); render();
  showOverlay('<h2>대국으로 돌아가는 중…</h2>');
  net.connect();
  const until = setInterval(() => {
    if (room || !loadSession()) { clearInterval(until); if (!room) invite ? joinInvite(invite) : showOnline(); }
  }, 100);
} else if (invite) joinInvite(invite);
else showTitle();

/* @test-hooks:start */
window.__yt = { get st() { return st; }, get mode() { return mode; }, get phase() { return phase; }, get room() { return room; }, get sel() { return sel; }, get thinking() { return thinking; }, T, doRoll, doScore, startCpu, render };
/* @test-hooks:end */
})();
