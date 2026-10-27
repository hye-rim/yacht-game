'use strict';

// 서버 시험: 보안·안정성 회귀 + 요트 다이스 온라인 대국 흐름
// 실행: npm test  (Node 18 이상, 별도 설치 없이 node:test)
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const { WebSocket } = require('ws');
const L = require('../public/logic.js');

// 운영체제가 지금 비어 있는 포트를 골라 준다 (고정 포트·범위 난수는 다른 서버와 겹쳐 가끔 실패한다)
const freePort = () => Number(require('child_process').execFileSync(process.execPath, ['-e', "const s = require('net').createServer().listen(0, '127.0.0.1', () => { console.log(s.address().port); s.close(); })"]));
const PORT = freePort();
const get = (p) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port: PORT, path: p, method: 'GET' }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
  req.on('error', reject); req.end();
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORT), TURN_MS: '2500' }, stdio: 'ignore' });
child.unref();
process.on('exit', () => child.kill());
const ready = (async () => {
  for (let i = 0; i < 80; i++) { try { await get('/'); return; } catch { await sleep(100); } }
  throw new Error('server did not start');
})();

const open = () => new Promise((resolve, reject) => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/`);
  const c = { ws, msgs: [], room: null, queued: false, errors: [], closed: null };
  ws.on('message', (d) => {
    let m; try { m = JSON.parse(d); } catch { return; }
    c.msgs.push(m);
    if (m.t === 'room') c.room = m;
    if (m.t === 'queued') c.queued = true;
    if (m.t === 'error') c.errors.push(m.msg);
  });
  ws.on('close', (code) => { c.closed = code; });
  ws.on('error', () => {});
  ws.on('open', () => resolve(c));
  setTimeout(() => reject(new Error('websocket connect failed')), 3000);
});
const send = (c, t, p = {}) => c.ws.send(JSON.stringify({ t, ...p }));
const until = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(10); } return false; };

// 두 손님을 빠른 대전으로 맺어 준다
async function pair() {
  const a = await open(), b = await open();
  send(a, 'hello', { name: '가' }); send(b, 'hello', { name: '나' });
  send(a, 'quick'); await until(() => a.queued);
  send(b, 'quick');
  assert.ok(await until(() => a.room && b.room && a.room.state === 'playing' && b.room.state === 'playing'), 'both players enter a playing room');
  return [a, b];
}
const mover = (a, b) => (a.room.turn === a.room.you ? a : b);
const stOf = (room) => { const g = L.newGame(); g.dice = room.dice.slice(); g.held = room.held.slice(); g.rollsLeft = room.rollsLeft; g.cards = room.cards.map((c) => c.slice()); g.turn = room.turn; return g; };
const closeAll = (...cs) => cs.forEach((c) => c.ws.close());
// 컴퓨터 한 동작 (굴리기 또는 점수 적기)을 서버로 보내고 반영될 때까지 기다린다
async function oneAction(a, b, level = 'easy') {
  const m = mover(a, b);
  const before = JSON.stringify([m.room.dice, m.room.rollsLeft, m.room.cards, m.room.turn]);
  const act = L.aiPick(stOf(m.room), level, Math.random);
  if (act.type === 'roll') {
    if (m.room.rollsLeft < 3) send(m, 'hold', { mask: act.hold });
    send(m, 'roll');
  } else send(m, 'score', { cat: act.cat });
  await until(() => a.room.state === 'over' || JSON.stringify([a.room.dice, a.room.rollsLeft, a.room.cards, a.room.turn]) !== before, 3000);
}

test('malformed URLs get 400 and the server stays up', async () => {
  await ready;
  assert.strictEqual(await get('/%'), 400);
  assert.strictEqual(await get('/%00'), 400);
  assert.strictEqual(await get('/'), 200);
  assert.strictEqual(await get('/logic.js'), 200);
});

test('dotfiles and paths outside the public dir are not served', async () => {
  await ready;
  assert.strictEqual(await get('/.git/config'), 403);
  assert.ok([403, 404].includes(await get('/../server.js')));
});

test('oversized websocket message closes the connection (1009)', async () => {
  await ready;
  const c = await open();
  c.ws.send('x'.repeat(2 * 1024 * 1024));
  await sleep(500);
  assert.strictEqual(c.closed, 1009);
  assert.strictEqual(await get('/'), 200);
});

test('quick match starts with empty cards and the first player to roll', async () => {
  await ready;
  const [a, b] = await pair();
  assert.notStrictEqual(a.room.you, b.room.you);
  assert.strictEqual(a.room.turn, 0);
  assert.strictEqual(a.room.rollsLeft, 3);
  assert.deepStrictEqual(a.room.dice, [0, 0, 0, 0, 0]);
  assert.ok(a.room.cards.every((c) => c.length === 12 && c.every((v) => v === null)));
  closeAll(a, b);
});

test('out-of-turn, premature and garbage actions are ignored', async () => {
  await ready;
  const [a, b] = await pair();
  const first = mover(a, b), second = first === a ? b : a;
  send(second, 'roll');                                             // 내 차례가 아님
  send(second, 'score', { cat: 0 });
  send(first, 'score', { cat: 0 });                                 // 아직 안 굴림
  send(first, 'hold', { mask: [true, true, true, true, true] });    // 아직 안 굴림
  for (const m of [{}, { cat: 'a' }, { cat: 12 }, { cat: -1 }, { cat: 1.5 }, { cat: null }, { cat: [1] }]) send(first, 'score', m);
  await sleep(300);
  assert.strictEqual(a.room.rollsLeft, 3, 'nothing happened');
  assert.deepStrictEqual(a.room.dice, [0, 0, 0, 0, 0]);
  assert.ok(a.room.cards[0].every((v) => v === null));
  closeAll(a, b);
});

test('rolling and holding: three rolls, held dice stay, a fourth roll is refused', async () => {
  await ready;
  const [a, b] = await pair();
  const first = mover(a, b);
  send(first, 'roll');
  assert.ok(await until(() => a.room.rollsLeft === 2 && b.room.rollsLeft === 2));
  assert.ok(a.room.dice.every((d) => d >= 1 && d <= 6));
  const d1 = a.room.dice.slice();
  for (const m of [{}, { mask: [true] }, { mask: [1, 1, 1, 1, 1] }, { mask: 'xxxxx' }, { mask: null }]) send(first, 'hold', m);
  send(first, 'hold', { mask: [true, false, true, false, true] });
  assert.ok(await until(() => a.room.held[0] === true && b.room.held[0] === true), 'the opponent sees the holds');
  send(first, 'roll');
  assert.ok(await until(() => a.room.rollsLeft === 1));
  assert.strictEqual(a.room.dice[0], d1[0]); assert.strictEqual(a.room.dice[2], d1[2]); assert.strictEqual(a.room.dice[4], d1[4]);
  send(first, 'hold', { mask: [false, false, false, false, false] });
  send(first, 'roll');
  assert.ok(await until(() => a.room.rollsLeft === 0));
  send(first, 'roll');
  await sleep(200);
  assert.strictEqual(a.room.rollsLeft, 0, 'no fourth roll');
  closeAll(a, b);
});

test('scoring writes the card for both, passes the turn and reports the last move', async () => {
  await ready;
  const [a, b] = await pair();
  const first = mover(a, b), second = first === a ? b : a;
  send(first, 'roll');
  assert.ok(await until(() => a.room.rollsLeft === 2));
  const dice = a.room.dice.slice();
  send(first, 'score', { cat: 6 });
  assert.ok(await until(() => a.room.turn === 1 && b.room.turn === 1));
  assert.strictEqual(a.room.cards[0][6], dice.reduce((x, y) => x + y, 0));
  assert.deepStrictEqual(a.room.lastMove, { seq: 1, who: 0, cat: 6, pts: dice.reduce((x, y) => x + y, 0), dice });
  assert.strictEqual(a.room.rollsLeft, 3);
  send(first, 'roll');                                              // 이제 상대 차례
  await sleep(200);
  assert.strictEqual(a.room.rollsLeft, 3);
  send(second, 'roll');
  assert.ok(await until(() => a.room.rollsLeft === 2));
  send(second, 'score', { cat: 6 });
  assert.ok(await until(() => a.room.turn === 0));
  send(first, 'roll');
  assert.ok(await until(() => a.room.rollsLeft === 2));
  send(first, 'score', { cat: 6 });                                 // 이미 쓴 칸은 거절
  await sleep(200);
  assert.strictEqual(a.room.turn, 0);
  closeAll(a, b);
});

test('two computers play a full 24-turn game through the server', async () => {
  await ready;
  const [a, b] = await pair();
  for (let i = 0; i < 400 && a.room.state === 'playing'; i++) await oneAction(a, b, i % 2 ? 'easy' : 'hard');
  assert.ok(await until(() => a.room.state === 'over' && b.room.state === 'over', 3000), 'the game ends');
  assert.strictEqual(a.room.reason, 'done');
  const t = (c) => L.total(c);
  const x = t(a.room.cards[0]), y = t(a.room.cards[1]);
  assert.strictEqual(a.room.winner, x > y ? 0 : y > x ? 1 : 2);
  assert.ok(a.room.cards.every((c) => c.every((v) => v !== null)));
  closeAll(a, b);
});

test('resigning ends the game and rematch swaps sides', async () => {
  await ready;
  const [a, b] = await pair();
  const sideA = a.room.you;
  send(a, 'resign');
  assert.ok(await until(() => b.room.state === 'over'));
  assert.strictEqual(b.room.reason, 'resign');
  assert.strictEqual(b.room.winner, b.room.you);
  send(a, 'rematch'); send(b, 'rematch');
  assert.ok(await until(() => a.room.state === 'playing' && a.room.games === 2));
  assert.notStrictEqual(a.room.you, sideA, 'sides swap on a rematch');
  assert.ok(a.room.cards.every((c) => c.every((v) => v === null)));
  closeAll(a, b);
});

test('running out of time loses the game for the one on move', async () => {
  await ready;
  const [a, b] = await pair();
  const first = mover(a, b);
  assert.ok(await until(() => a.room.state === 'over', 5000), 'the timer fires');
  assert.strictEqual(a.room.reason, 'timeout');
  assert.strictEqual(a.room.winner, 1 - first.room.you);
  closeAll(a, b);
});

test('private rooms: create, join by code, and a third player is turned away', async () => {
  await ready;
  const a = await open(), b = await open(), c = await open();
  send(a, 'create');
  assert.ok(await until(() => a.room && a.room.code));
  assert.strictEqual(a.room.state, 'waiting');
  send(b, 'join', { code: a.room.code.toLowerCase() });
  assert.ok(await until(() => a.room.state === 'playing' && b.room && b.room.state === 'playing'));
  send(c, 'join', { code: a.room.code });
  assert.ok(await until(() => c.errors.length > 0));
  assert.match(c.errors[0], /이미 두 사람/);
  a.ws.close(); b.ws.close(); c.ws.close();
});

test('a dropped player can resume the same seat with the token', async () => {
  await ready;
  const [a, b] = await pair();
  const token = a.room.token, code = a.room.code, you = a.room.you;
  a.ws.close();
  assert.ok(await until(() => b.room.players.some((p) => !p.online)), 'the other side sees the drop');
  const a2 = await open();
  send(a2, 'resume', { code, token });
  assert.ok(await until(() => a2.room && a2.room.you === you && a2.room.state === 'playing'));
  assert.ok(await until(() => b.room.players.every((p) => p.online)));
  a2.ws.close(); b.ws.close();
});

// 같은 주소에서 코드를 일부러 많이 틀리므로 이 시험은 맨 뒤에 둔다 (뒤의 시험이 막히지 않게)
test('repeated wrong room codes get temporarily blocked', async () => {
  await ready;
  const c = await open();
  for (let i = 0; i < 10; i++) c.ws.send(JSON.stringify({ t: 'join', code: 'ZZZ' + 'ABCDEFGH'[i] }));
  await sleep(500);
  assert.ok(c.errors.some((x) => /그런 방이 없어요/.test(x)), 'first attempts are answered with room-not-found');
  assert.ok(c.errors.some((x) => /너무 많이 틀렸어요/.test(x)), 'many wrong codes get blocked');
  c.ws.close();
});

test('shutdown', () => { child.kill(); });
