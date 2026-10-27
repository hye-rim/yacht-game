'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const L = require('../public/logic.js');

const S = (cat, dice) => L.score(cat, dice);

test('upper categories sum the matching faces', () => {
  assert.strictEqual(S('ones', [1, 1, 2, 3, 1]), 3);
  assert.strictEqual(S('sixes', [6, 6, 2, 3, 6]), 18);
  assert.strictEqual(S('fives', [1, 2, 3, 4, 6]), 0);
  assert.strictEqual(S(2, [3, 3, 3, 3, 3]), 15);
});

test('choice sums all dice', () => {
  assert.strictEqual(S('choice', [1, 2, 3, 4, 5]), 15);
  assert.strictEqual(S('choice', [6, 6, 6, 6, 6]), 30);
});

test('four of a kind needs four equal and sums all dice', () => {
  assert.strictEqual(S('fourkind', [4, 4, 4, 4, 2]), 18);
  assert.strictEqual(S('fourkind', [4, 4, 4, 2, 2]), 0);
  assert.strictEqual(S('fourkind', [5, 5, 5, 5, 5]), 25);
});

test('full house is exactly three plus two', () => {
  assert.strictEqual(S('fullhouse', [2, 2, 3, 3, 3]), 13);
  assert.strictEqual(S('fullhouse', [2, 2, 2, 2, 3]), 0);
  assert.strictEqual(S('fullhouse', [6, 6, 6, 6, 6]), 0);
  assert.strictEqual(S('fullhouse', [1, 2, 3, 4, 5]), 0);
});

test('straights', () => {
  assert.strictEqual(S('sstraight', [1, 2, 3, 4, 6]), 15);
  assert.strictEqual(S('sstraight', [2, 3, 4, 5, 5]), 15);
  assert.strictEqual(S('sstraight', [3, 4, 5, 6, 6]), 15);
  assert.strictEqual(S('sstraight', [1, 2, 3, 5, 6]), 0);
  assert.strictEqual(S('sstraight', [1, 2, 3, 4, 5]), 15);
  assert.strictEqual(S('lstraight', [1, 2, 3, 4, 5]), 30);
  assert.strictEqual(S('lstraight', [2, 3, 4, 5, 6]), 30);
  assert.strictEqual(S('lstraight', [1, 2, 3, 4, 6]), 0);
  assert.strictEqual(S('lstraight', [1, 1, 2, 3, 4]), 0);
});

test('yacht is five equal dice worth 50', () => {
  assert.strictEqual(S('yacht', [3, 3, 3, 3, 3]), 50);
  assert.strictEqual(S('yacht', [3, 3, 3, 3, 4]), 0);
});

test('bonus at 63 in the upper section', () => {
  const card = new Array(12).fill(null);
  for (let i = 0; i < 6; i++) card[i] = 3 * (i + 1);
  assert.strictEqual(L.upperSum(card), 63);
  assert.strictEqual(L.bonus(card), 35);
  assert.strictEqual(L.total(card), 98);
  card[0] = 2;
  assert.strictEqual(L.upperSum(card), 62);
  assert.strictEqual(L.bonus(card), 0);
  assert.strictEqual(L.total(card), 62);
});

test('rolling rules: three rolls, holds kept, first roll rolls all', () => {
  const st = L.newGame();
  assert.strictEqual(L.rolled(st), false);
  assert.strictEqual(L.toggleHold(st, 0), false);        // before the first roll nothing can be held
  assert.strictEqual(L.scoreCat(st, 0), null);           // and nothing can be scored
  const r = L.rng(5);
  assert.ok(L.rollDice(st, r));
  assert.ok(st.dice.every((d) => d >= 1 && d <= 6));
  assert.strictEqual(st.rollsLeft, 2);
  const first = st.dice.slice();
  assert.ok(L.toggleHold(st, 1));
  assert.ok(L.toggleHold(st, 3));
  assert.ok(L.rollDice(st, r));
  assert.strictEqual(st.dice[1], first[1]);
  assert.strictEqual(st.dice[3], first[3]);
  assert.ok(L.rollDice(st, r));
  assert.strictEqual(st.rollsLeft, 0);
  assert.strictEqual(L.rollDice(st, r), false);          // a fourth roll is refused
  assert.strictEqual(L.toggleHold(st, 0), false);
});

test('all dice held means no roll happens', () => {
  const st = L.newGame();
  L.rollDice(st, L.rng(1));
  L.setHold(st, [true, true, true, true, true]);
  assert.strictEqual(L.rollDice(st, L.rng(2)), false);
  assert.strictEqual(st.rollsLeft, 2);
});

test('scoring writes the card, passes the turn and refuses reuse', () => {
  const st = L.newGame();
  L.rollDice(st, L.rng(7));
  st.dice = [6, 6, 6, 2, 2];
  const res = L.scoreCat(st, 'fullhouse');
  assert.strictEqual(res.pts, 22);
  assert.strictEqual(st.cards[0][8], 22);
  assert.strictEqual(st.turn, 1);
  assert.strictEqual(st.rollsLeft, 3);
  assert.deepStrictEqual(st.dice, [0, 0, 0, 0, 0]);
  assert.strictEqual(st.last.who, 0);
  L.rollDice(st, L.rng(8));
  st.turn = 0; st.rollsLeft = 1; st.dice = [1, 2, 3, 4, 5];
  assert.strictEqual(L.scoreCat(st, 'fullhouse'), null);  // already used
  assert.strictEqual(L.scoreCat(st, 99), null);
  assert.strictEqual(L.scoreCat(st, 'lstraight').pts, 30);
});

test('a zero can be written and the game ends after 24 turns with a winner', () => {
  const st = L.newGame();
  const r = L.rng(11);
  let turns = 0;
  while (!st.over) {
    L.rollDice(st, r);
    const open = L.openCats(st);
    L.scoreCat(st, open[0]);
    turns++;
    assert.ok(turns <= 24);
  }
  assert.strictEqual(turns, 24);
  const a = L.total(st.cards[0]), b = L.total(st.cards[1]);
  assert.strictEqual(st.winner, a > b ? 0 : b > a ? 1 : 2);
});

test('tie gives a draw', () => {
  const st = L.newGame();
  st.cards[0] = new Array(12).fill(0);
  st.cards[1] = new Array(12).fill(0);
  st.cards[0][11] = null;
  st.dice = [1, 2, 3, 4, 6]; st.rollsLeft = 2;
  L.scoreCat(st, 'yacht');
  st.cards[1][11] = null;
  st.turn = 1; st.over = false; st.dice = [1, 2, 3, 4, 6]; st.rollsLeft = 2;
  L.scoreCat(st, 'yacht');
  assert.ok(st.over);
  assert.strictEqual(st.winner, 2);
});

test('ai always plays legal moves and finishes games', () => {
  for (const level of ['easy', 'hard']) {
    const st = L.newGame();
    const r = L.rng(21);
    let guard = 0;
    while (!st.over && guard++ < 200) {
      const act = L.aiPick(st, level, r);
      if (act.type === 'score') {
        assert.ok(L.rolled(st), 'scored before rolling');
        assert.ok(L.isOpen(st, st.turn, act.cat), 'scored a used category');
      } else {
        assert.ok(act.hold.length === 5);
        assert.ok(st.rollsLeft > 0, 'rolled with none left');
      }
      assert.ok(L.apply(st, act, r), 'move refused');
    }
    assert.ok(st.over, level + ' did not finish');
  }
});

test('hard ai goes for the yacht and finishes straights', () => {
  const st = L.newGame();
  L.rollDice(st, L.rng(3));
  st.dice = [4, 4, 4, 4, 2]; st.rollsLeft = 2;
  const a = L.aiPick(st, 'hard', () => 0.99);
  assert.strictEqual(a.type, 'roll');
  assert.deepStrictEqual(a.hold, [true, true, true, true, false]);
  st.dice = [1, 2, 3, 4, 5]; st.rollsLeft = 2;
  const b = L.aiPick(st, 'hard', () => 0.99);
  assert.strictEqual(b.type, 'score');
  assert.strictEqual(b.cat, 10);                         // large straight
  st.dice = [6, 6, 6, 6, 6]; st.rollsLeft = 1;
  assert.deepStrictEqual(L.aiPick(st, 'hard', () => 0.99), { type: 'score', cat: 11 });
});

test('hard ai decision is fast', () => {
  const st = L.newGame();
  L.rollDice(st, L.rng(9));
  st.dice = [1, 3, 3, 5, 6]; st.rollsLeft = 2;
  const t = Date.now();
  L.aiPick(st, 'hard', () => 0.99);
  assert.ok(Date.now() - t < 1500, 'too slow: ' + (Date.now() - t));
});

test('hard beats easy over a seeded series', () => {
  let hard = 0, easy = 0, ptsH = 0, ptsE = 0;
  const N = 24;
  for (let g = 0; g < N; g++) {
    const st = L.newGame();
    const r = L.rng(1000 + g);
    const lv = g % 2 === 0 ? ['hard', 'easy'] : ['easy', 'hard'];
    while (!st.over) L.apply(st, L.aiPick(st, lv[st.turn], r), r);
    const h = lv.indexOf('hard'), e = 1 - h;
    ptsH += L.total(st.cards[h]); ptsE += L.total(st.cards[e]);
    if (st.winner === h) hard++; else if (st.winner === e) easy++;
  }
  assert.ok(hard >= 18, 'hard won only ' + hard + ' of ' + N + ' (easy ' + easy + ')');
  assert.ok(ptsH > ptsE);
});

test('same seed gives the same game', () => {
  const run = () => {
    const st = L.newGame();
    const r = L.rng(77);
    while (!st.over) L.apply(st, L.aiPick(st, 'hard', r), r);
    return JSON.stringify(st.cards);
  };
  assert.strictEqual(run(), run());
});
