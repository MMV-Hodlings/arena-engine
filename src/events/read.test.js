import test from 'node:test';
import assert from 'node:assert';
import { read } from './read.js';
import { hashSeed } from '../rng.js';

const open = () => read.init(hashSeed('read'), { heavyBy: 0 }).value;
const at = (ms) => ms;

test('the event declares its shape', () => {
  assert.equal(read.id, 'read');
  assert.ok(read.durationMs > 0);
  assert.ok(read.momentumShift > 0);
});

test('nobody picking leaves both on guard', () => {
  const scored = read.score(open());
  assert.deepEqual(scored.exchange, { a: 'guard', b: 'guard' });
});

test('a pick is recorded', () => {
  let state = open();
  state = read.reduce(state, { player: 'a', payload: { stance: 'overload' }, atMs: at(100) });
  assert.deepEqual(read.score(state).exchange, { a: 'overload', b: 'guard' });
});

test('an unknown stance is ignored rather than accepted', () => {
  let state = open();
  state = read.reduce(state, { player: 'a', payload: { stance: 'teleport' }, atMs: at(100) });
  assert.equal(read.score(state).exchange.a, 'guard');
});

test('only the first pick counts, so nobody can change their mind late', () => {
  let state = open();
  state = read.reduce(state, { player: 'b', payload: { stance: 'strike' }, atMs: at(100) });
  state = read.reduce(state, { player: 'b', payload: { stance: 'guard' }, atMs: at(200) });
  assert.equal(read.score(state).exchange.b, 'strike');
});

test('winning the read scores one, losing scores zero, a tie scores a half', () => {
  const play = (a, b) => {
    let state = open();
    state = read.reduce(state, { player: 'a', payload: { stance: a }, atMs: at(50) });
    state = read.reduce(state, { player: 'b', payload: { stance: b }, atMs: at(60) });
    return read.score(state);
  };
  assert.deepEqual({ a: play('strike', 'overload').a, b: play('strike', 'overload').b }, { a: 1, b: 0 });
  assert.deepEqual({ a: play('guard', 'overload').a, b: play('guard', 'overload').b }, { a: 0, b: 1 });
  const tie = play('strike', 'strike');
  assert.equal(tie.a, 0.5);
  assert.equal(tie.b, 0.5);
});

test('the exchange is handed to the reducer verbatim', () => {
  let state = open();
  state = read.reduce(state, { player: 'a', payload: { stance: 'overload' }, atMs: at(10) });
  state = read.reduce(state, { player: 'b', payload: { stance: 'guard' }, atMs: at(20) });
  assert.deepEqual(read.score(state).exchange, { a: 'overload', b: 'guard' });
});
