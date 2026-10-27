'use strict';

// 요트 다이스: 규칙과 컴퓨터만 모아 둔 파일 (그리기·입력 없음). 브라우저·서버·테스트(Node)가 같이 쓴다.
//
// - 주사위 5개. 자기 차례에 **최대 3번** 굴린다. 첫 굴림 뒤에는 남길(고정) 주사위를 고르고 나머지만 다시 굴린다
// - 굴린 뒤에는 점수 칸 12개 중 **아직 안 쓴 칸 하나**에 점수를 적는다 (한 번 적은 칸은 못 바꾼다. 0점도 적어야 한다)
// - 두 사람이 12칸씩 모두 채우면(12라운드) 끝. 합계가 큰 쪽이 이긴다
// - 칸: 1~6의 눈(그 눈의 합) · 초이스(다섯 개 합) · 포카드(같은 눈 4개 이상이면 다섯 개 합) · 풀하우스(3+2 이면 다섯 개 합)
//        · 스몰 스트레이트(4개 이어짐 15) · 라지 스트레이트(5개 이어짐 30) · 요트(다섯 개 모두 같으면 50)
// - 1~6의 눈 칸의 합이 63 이상이면 보너스 35점 (각 눈 3개씩이면 정확히 63)
const LOGIC_YACHT = (() => {
const DICE = 5, ROLLS = 3;
const CATS = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes', 'choice', 'fourkind', 'fullhouse', 'sstraight', 'lstraight', 'yacht'];
const NAMES = ['1의 눈', '2의 눈', '3의 눈', '4의 눈', '5의 눈', '6의 눈', '초이스', '포카드', '풀하우스', '스몰 스트레이트', '라지 스트레이트', '요트'];
const UPPER = 6;                       // 앞의 6칸이 1~6의 눈
const BONUS_AT = 63, BONUS = 35;

function rng(seed) {                   // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 눈 개수 [1의 개수 .. 6의 개수]
function countsOf(dice) {
  const c = [0, 0, 0, 0, 0, 0];
  for (const d of dice) if (d >= 1 && d <= 6) c[d - 1]++;
  return c;
}

function scoreCounts(cat, c) {
  const sum = c[0] + 2 * c[1] + 3 * c[2] + 4 * c[3] + 5 * c[4] + 6 * c[5];
  if (cat < UPPER) return c[cat] * (cat + 1);
  switch (CATS[cat]) {
    case 'choice': return sum;
    case 'fourkind': return c.some((n) => n >= 4) ? sum : 0;
    case 'fullhouse': return c.some((n) => n === 3) && c.some((n) => n === 2) ? sum : 0;
    case 'sstraight': return [0, 1, 2].some((i) => c[i] && c[i + 1] && c[i + 2] && c[i + 3]) ? 15 : 0;
    case 'lstraight': return (c[0] && c[1] && c[2] && c[3] && c[4]) || (c[1] && c[2] && c[3] && c[4] && c[5]) ? 30 : 0;
    case 'yacht': return c.some((n) => n === DICE) ? 50 : 0;
  }
  return 0;
}

// cat: 칸 번호(0~11) 또는 이름. 주사위가 아직 안 굴려졌으면(0) 0점
function score(cat, dice) {
  const k = typeof cat === 'string' ? CATS.indexOf(cat) : cat;
  if (k < 0 || k >= CATS.length) return 0;
  return scoreCounts(k, countsOf(dice));
}

function newGame() {
  return {
    dice: [0, 0, 0, 0, 0],             // 0 은 아직 안 굴림
    held: [false, false, false, false, false],
    rollsLeft: ROLLS,                  // 3 이면 이번 차례에 아직 안 굴림
    turn: 0,
    cards: [new Array(CATS.length).fill(null), new Array(CATS.length).fill(null)],
    winner: -1,                        // -1 진행 중 · 0 · 1 · 2 무승부
    over: false,
    last: null,                        // 마지막으로 점수를 적은 곳 { who, cat, pts, dice }
  };
}

function clone(st) {
  return { ...st, dice: st.dice.slice(), held: st.held.slice(), cards: st.cards.map((c) => c.slice()), last: st.last ? { ...st.last, dice: st.last.dice.slice() } : null };
}

const rolled = (st) => st.rollsLeft < ROLLS;

// 안 고정된 주사위를 다시 굴린다. 첫 굴림은 모두 굴린다
function rollDice(st, rand = Math.random) {
  if (st.over || st.rollsLeft <= 0) return false;
  if (st.rollsLeft === ROLLS) st.held = [false, false, false, false, false];
  if (st.held.every(Boolean)) return false;        // 전부 고정이면 굴릴 게 없다
  for (let i = 0; i < DICE; i++) if (!st.held[i]) st.dice[i] = 1 + Math.floor(rand() * 6);
  st.rollsLeft--;
  return true;
}

// 주사위 i 를 고정/해제한다. 굴린 뒤, 다시 굴릴 수 있을 때만
function toggleHold(st, i) {
  if (st.over || !Number.isInteger(i) || i < 0 || i >= DICE) return false;
  if (!rolled(st) || st.rollsLeft <= 0) return false;
  st.held[i] = !st.held[i];
  return true;
}

function setHold(st, mask) {
  if (st.over || !Array.isArray(mask) || mask.length !== DICE) return false;
  if (!rolled(st) || st.rollsLeft <= 0) return false;
  st.held = mask.map(Boolean);
  return true;
}

const isOpen = (st, p, cat) => st.cards[p][cat] === null;

// 지금 주사위로 칸 cat 에 점수를 적는다
function scoreCat(st, cat) {
  const k = typeof cat === 'string' ? CATS.indexOf(cat) : cat;
  if (st.over || !rolled(st) || !Number.isInteger(k) || k < 0 || k >= CATS.length) return null;
  const p = st.turn;
  if (!isOpen(st, p, k)) return null;
  const pts = score(k, st.dice);
  st.cards[p][k] = pts;
  st.last = { who: p, cat: k, pts, dice: st.dice.slice() };
  if (st.cards[0].every((v) => v !== null) && st.cards[1].every((v) => v !== null)) {
    st.over = true;
    const a = total(st.cards[0]), b = total(st.cards[1]);
    st.winner = a > b ? 0 : b > a ? 1 : 2;
  } else {
    st.turn = 1 - p;
    st.dice = [0, 0, 0, 0, 0];
    st.held = [false, false, false, false, false];
    st.rollsLeft = ROLLS;
  }
  return { who: p, cat: k, pts, over: st.over };
}

function upperSum(card) {
  let s = 0;
  for (let i = 0; i < UPPER; i++) s += card[i] || 0;
  return s;
}
const bonus = (card) => (upperSum(card) >= BONUS_AT ? BONUS : 0);
function total(card) {
  let s = bonus(card);
  for (const v of card) s += v || 0;
  return s;
}
const openCats = (st, p = st.turn) => CATS.map((_, i) => i).filter((i) => st.cards[p][i] === null);

// ---------- 컴퓨터 ----------
// 쉬움: 가장 많이 나온 눈을 모아 가고(가끔 아무렇게나 고정), 마지막에는 그 순간 점수가 가장 큰 칸에 적는다 (가끔 아무 칸)
// 어려움: 굴림이 남은 만큼 앞을 내다보는 기댓값 계산. 칸마다 "평소 이 정도 나온다"는 기준(PAR)을 빼서 아깝지 않게 적는다

const PAR = [3, 6, 9, 12, 15, 18, 23, 11, 17, 12, 10, 8];   // 칸마다 평소 기대 점수의 대략값

// 크기 m 인 눈 묶음(개수 배열)과 그 확률 (m = 0..5)
const OUT = (() => {
  const fact = [1, 1, 2, 6, 24, 120];
  const res = [];
  for (let m = 0; m <= DICE; m++) {
    const list = [];
    (function gen(i, left, c) {
      if (i === 5) { c[5] = left; push(c.slice()); return; }
      for (let n = 0; n <= left; n++) { c[i] = n; gen(i + 1, left - n, c); }
    })(0, m, [0, 0, 0, 0, 0, 0]);
    function push(c) {
      let ways = fact[m];
      for (const n of c) ways /= fact[n];
      list.push({ c, p: ways / Math.pow(6, m) });
    }
    res.push(list);
  }
  return res;
})();

const keyOf = (c) => c[0] + 6 * c[1] + 36 * c[2] + 216 * c[3] + 1296 * c[4] + 7776 * c[5];

// 칸 cat 에 점수 pts 를 적었을 때의 값(기준을 뺀 값 + 보너스 문턱을 넘으면 가산)
function catValue(cat, pts, upSum) {
  let v = pts - PAR[cat];
  if (cat < UPPER && upSum < BONUS_AT && upSum + pts >= BONUS_AT) v += BONUS;
  return v;
}

function stopValue(c, open, upSum) {
  let best = -Infinity, bestCat = -1;
  for (const cat of open) {
    const v = catValue(cat, scoreCounts(cat, c), upSum);
    if (v > best) { best = v; bestCat = cat; }
  }
  return { v: best, cat: bestCat };
}

function searchHard(counts, rollsLeft, open, upSum) {
  const size = 46656;
  const V = [null, new Float64Array(size).fill(NaN), new Float64Array(size).fill(NaN)];
  const E = [null, new Float64Array(size).fill(NaN), new Float64Array(size).fill(NaN)];
  const stopMemo = new Float64Array(size).fill(NaN);
  const stop = (c) => {
    const k = keyOf(c);
    if (!Number.isNaN(stopMemo[k])) return stopMemo[k];
    return (stopMemo[k] = stopValue(c, open, upSum).v);
  };
  // 눈 묶음 keep 을 남기고 나머지를 굴렸을 때의 기댓값 (굴림이 r 번 남았을 때)
  const ev = (keep, r) => {
    const k = keyOf(keep);
    if (!Number.isNaN(E[r][k])) return E[r][k];
    const m = DICE - keep.reduce((a, b) => a + b, 0);
    let s = 0;
    for (const o of OUT[m]) {
      const c = keep.map((n, i) => n + o.c[i]);
      s += o.p * val(c, r - 1);
    }
    return (E[r][k] = s);
  };
  const forEachKeep = (c, fn) => {
    (function gen(i, keep) {
      if (i === 6) { fn(keep); return; }
      for (let n = 0; n <= c[i]; n++) { keep[i] = n; gen(i + 1, keep); }
    })(0, [0, 0, 0, 0, 0, 0]);
  };
  const val = (c, r) => {
    if (r === 0) return stop(c);
    const k = keyOf(c);
    if (!Number.isNaN(V[r][k])) return V[r][k];
    let best = stop(c);
    forEachKeep(c, (keep) => {
      if (keep.reduce((a, b) => a + b, 0) === DICE) return;
      const e = ev(keep, r);
      if (e > best) best = e;
    });
    return (V[r][k] = best);
  };
  // 지금 선택: 그만 적기 vs 어떤 묶음을 남기고 다시 굴리기
  const stopNow = stopValue(counts, open, upSum);
  let bestKeep = null, bestE = -Infinity;
  if (rollsLeft > 0) {
    forEachKeep(counts, (keep) => {
      if (keep.reduce((a, b) => a + b, 0) === DICE) return;
      const e = ev(keep, rollsLeft);
      if (e > bestE + 1e-9) { bestE = e; bestKeep = keep.slice(); }
    });
  }
  if (bestKeep && bestE > stopNow.v + 1e-9) return { keep: bestKeep };
  return { cat: stopNow.cat };
}

// keep(눈 개수)에 맞춰 실제 주사위 위치를 고른다
function maskFor(dice, keep) {
  const left = keep.slice();
  return dice.map((d) => (left[d - 1] > 0 ? (left[d - 1]--, true) : false));
}

// 돌려주는 값: { type: 'roll', hold: [bool x5] } 또는 { type: 'score', cat }
function aiPick(st, level = 'easy', rand = Math.random) {
  const p = st.turn;
  const open = openCats(st, p);
  if (!rolled(st)) return { type: 'roll', hold: [false, false, false, false, false] };
  const counts = countsOf(st.dice);
  if (level === 'hard') {
    const r = searchHard(counts, st.rollsLeft, open, upperSum(st.cards[p]));
    if (r.keep) return { type: 'roll', hold: maskFor(st.dice, r.keep) };
    return { type: 'score', cat: r.cat };
  }
  // 쉬움
  if (st.rollsLeft > 0) {
    const yacht = counts.some((n) => n === DICE);
    if (!yacht) {
      let face = 0;
      for (let i = 0; i < 6; i++) if (counts[i] > counts[face] || (counts[i] === counts[face] && i > face)) face = i;
      const hold = rand() < 0.25
        ? st.dice.map(() => rand() < 0.5)
        : st.dice.map((d) => d === face + 1);
      if (!hold.every(Boolean)) return { type: 'roll', hold };
    }
  }
  if (rand() < 0.15) return { type: 'score', cat: open[Math.floor(rand() * open.length)] };
  let best = open[0], bs = -1;
  for (const cat of open) {
    const s = scoreCounts(cat, counts);
    if (s > bs) { bs = s; best = cat; }
  }
  return { type: 'score', cat: best };
}

// 컴퓨터가 쓰는 동작을 상태에 적용한다 (화면·시험용)
function apply(st, act, rand = Math.random) {
  if (act.type === 'roll') {
    if (rolled(st)) setHold(st, act.hold);
    return rollDice(st, rand);
  }
  return scoreCat(st, act.cat);
}

return { DICE, ROLLS, CATS, NAMES, UPPER, BONUS_AT, BONUS, PAR, rng, countsOf, score, newGame, clone, rolled, rollDice, toggleHold, setHold, scoreCat, upperSum, bonus, total, openCats, isOpen, aiPick, apply };
})();
if (typeof module !== 'undefined') module.exports = LOGIC_YACHT;
