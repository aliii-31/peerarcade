const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const tick = () => new Promise(setImmediate)
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const state = (overrides = {}) => ({ matchId: 'a', revision: 0, board: Array(9).fill(null), currentPlayer: 'X', status: 'playing', winner: null, ...overrides })
function setup() {
  const elements = new Map()
  const el = id => {
    if (!elements.has(id)) elements.set(id, { textContent: '', disabled: false, dataset: {}, attrs: {}, events: {}, setAttribute(k,v) { this.attrs[k] = v }, addEventListener(k,v) { this.events[k] = v } })
    return elements.get(id)
  }
  let snapshot = state()
  const calls = []
  const api = { gameState: async () => snapshot, requestMove: async r => { calls.push(r); return snapshot } }
  const window = { peerArcade: api }
  vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname, '../renderer/game.js'), 'utf8'), { window, document: { getElementById: el } })
  const ui = window.peerArcadeGame
  const connect = async (role = 'host') => { ui.updateRoom({ status: 'connected', role }); await ui.refresh() }
  return { el, api, ui, calls, connect, set: s => { snapshot = s }, click: i => el(`cell-${i}`).events.click() }
}
test('initial board is empty, labelled and disabled; host/guest symbols and turns', async () => {
  const u = setup()
  for (let i=0;i<9;i++) { assert.equal(u.el(`cell-${i}`).textContent, ''); assert.equal(u.el(`cell-${i}`).disabled, true) }
  await u.connect()
  assert.match(u.el('player-symbol').textContent, /Host.*X/)
  assert.equal(u.el('game-status').textContent, 'Your turn')
  assert.equal(u.el('cell-0').disabled, false)
  await u.connect('guest')
  assert.match(u.el('player-symbol').textContent, /Guest.*O/)
  assert.equal(u.el('cell-0').disabled, true)
  assert.equal(u.el('game-status').textContent, "Opponent's turn")
})
test('remote accepted updates render occupied cells and enforce turn', async () => {
  const u = setup(); await u.connect('guest')
  u.set(state({ board: ['X',null,null,null,null,null,null,null,null], currentPlayer: 'O', revision: 1 }))
  await u.ui.refresh()
  assert.equal(u.el('cell-0').textContent, 'X'); assert.equal(u.el('cell-0').disabled, true)
  assert.equal(u.el('cell-1').disabled, false)
})
test('pending moves never place optimistic marks; IDs and revision accompany moves', async () => {
  const u = setup(); await u.connect()
  const d = deferred(); u.api.requestMove = r => { u.calls.push(r); return d.promise }
  const pending = u.click(0)
  assert.equal(u.el('cell-0').textContent, '')
  assert.equal(u.el('cell-1').disabled, true)
  assert.match(u.el('game-status').textContent, /pending/)
  await u.click(1); assert.equal(u.calls.length, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(u.calls[0])), { matchId:'a', revision:0, requestId:1, position:0 })
  d.resolve(state({ board:['X',null,null,null,null,null,null,null,null], revision:1, currentPlayer:'O' }))
  await pending
  assert.equal(u.el('cell-0').textContent, 'X')
})
test('rejections and timeouts retrieve state before enabling another attempt', async () => {
  for (const message of ['Stale revision', 'Move timed out']) {
    const u = setup(); await u.connect()
    const d = deferred(); u.api.gameState = () => d.promise
    u.api.requestMove = async r => { u.calls.push(r); throw new Error(message) }
    const move = u.click(0); await tick()
    assert.equal(u.el('cell-0').disabled, true)
    assert.match(u.el('game-status').textContent, /Checking/)
    d.resolve(state()); await move
    assert.equal(u.el('cell-0').disabled, false)
    const next = u.click(1); await next
    assert.equal(u.calls[1].requestId, 2)
  }
})
for (const [status,winner,text] of [['won','X','You won'],['won','O','You lost'],['draw',null,'Draw']]) test(`result: ${text}`, async () => {
  const u=setup();u.set(state({status,winner,currentPlayer:null,revision:9}));await u.connect()
  assert.equal(u.el('game-status').textContent,text)
  for(let i=0;i<9;i++) assert.equal(u.el(`cell-${i}`).disabled,true)
})
test('departure clears board/pending and fresh match resets request counter', async () => {
  const u=setup();await u.connect()
  const d=deferred();u.api.requestMove=r=>{u.calls.push(r);return d.promise}
  const move=u.click(0)
  u.ui.updateRoom({status:'waiting',role:'host'})
  assert.equal(u.el('game-status').textContent,'Opponent disconnected')
  assert.equal(u.el('cell-0').textContent,'')
  u.set(state({matchId:'b'}));await u.connect()
  d.resolve(state({board:['X',null,null,null,null,null,null,null,null],revision:1}));await move
  assert.equal(u.el('cell-0').textContent,'')
  u.api.requestMove=async r=>{u.calls.push(r);return state({matchId:'b'})}
  await u.click(1)
  assert.equal(u.calls[1].matchId,'b');assert.equal(u.calls[1].requestId,1)
})
test('late polling results cannot restore a board after leaving; polls never overlap', async () => {
  const u=setup();await u.connect();const d=deferred();let count=0
  u.api.gameState=()=>{count++;return d.promise}
  const poll=u.ui.refresh();await u.ui.refresh();assert.equal(count,1)
  u.ui.reset();d.resolve(state({board:['X',null,null,null,null,null,null,null,null],revision:1}));await poll
  assert.equal(u.el('cell-0').textContent,'');assert.equal(u.el('cell-0').disabled,true)
})
test('older revision cannot overwrite accepted state; refresh failure locks board', async () => {
  const u=setup();u.set(state({revision:2,board:['X','O',null,null,null,null,null,null,null]}));await u.connect()
  u.set(state());await u.ui.refresh();assert.equal(u.el('cell-1').textContent,'O')
  u.api.gameState=async()=>{throw new Error('Worker unavailable')};await u.ui.refresh()
  assert.equal(u.el('cell-2').disabled,true);assert.match(u.el('game-error').textContent,/refresh/)
})
test('temporary reset retains increasing IDs if a failed room action returns to the same match', async () => {
  const u=setup();await u.connect();await u.click(0)
  u.ui.reset();await u.connect();await u.click(1)
  assert.equal(u.calls[0].requestId,1);assert.equal(u.calls[1].requestId,2)
})
test('late rejected move cannot display an error in a new match', async () => {
  const u=setup();await u.connect();const d=deferred();u.api.requestMove=()=>d.promise
  const move=u.click(0);u.ui.reset();u.set(state({matchId:'new'}));await u.connect()
  d.reject(new Error('Move timed out'));await move
  assert.equal(u.el('game-error').textContent,'');assert.equal(u.el('cell-0').disabled,false)
})
test('waiting and connecting status disable all moves', () => {
  const u=setup()
  u.ui.updateRoom({status:'waiting',role:'host'});assert.equal(u.el('game-status').textContent,'Waiting for opponent')
  u.ui.updateRoom({status:'joining',role:'guest'});assert.match(u.el('game-status').textContent,/Connecting/)
  for(let i=0;i<9;i++) assert.equal(u.el(`cell-${i}`).disabled,true)
})
