import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isValidSubmission, validEntryCount } from '../dist/types/shared/game.js';

const entries = Array.from({ length: 30 }, (_, index) => ({ id: `e${index + 1}`, text: `Entry ${index + 1}` }));
const challenge = (mode, count = 10) => ({ id: 'test', title: 'Test', description: '', category: 'Other', mode, entries: entries.slice(0, count), creator: 'tester', createdAt: 0, status: 'published' });

describe('challenge mode entry validation', () => {
  it('allows 2 to 10 entries for Rank Roulette', () => {
    assert.equal(validEntryCount('rank', 2), true);
    assert.equal(validEntryCount('rank', 10), true);
    assert.equal(validEntryCount('rank', 1), false);
    assert.equal(validEntryCount('rank', 11), false);
    assert.equal(validEntryCount('rank', 30), false);
    assert.equal(validEntryCount('rank', 31), false);
  });

  it('enforces minimum collection sizes for other modes', () => {
    assert.equal(validEntryCount('versus', 2), true);
    assert.equal(validEntryCount('versus', 1), false);
    assert.equal(validEntryCount('kmk', 3), true);
    assert.equal(validEntryCount('kmk', 2), false);
    assert.equal(validEntryCount('smash', 2), true);
    assert.equal(validEntryCount('smash', 1), false);
    assert.equal(validEntryCount('fact_cap', 2), true);
    assert.equal(validEntryCount('fact_cap', 1), false);
    assert.equal(validEntryCount('rating', 2), true);
    assert.equal(validEntryCount('rating', 1), true);
    assert.equal(validEntryCount('rating', 0), false);
  });
});

describe('server submission validation', () => {
  it('accepts a full blind ranking and rejects reused positions', () => {
    const valid = { mode: 'rank', values: Object.fromEntries(entries.slice(0, 10).map((entry, index) => [entry.id, index + 1])) };
    assert.equal(isValidSubmission(challenge('rank'), valid), true);
    assert.equal(isValidSubmission(challenge('rank'), { ...valid, values: { ...valid.values, e10: 9 } }), false);
  });

  it('requires three distinct entries for Kiss, Marry, Kill', () => {
    const valid = { mode: 'kmk', values: { Kiss: 'e1', Marry: 'e2', Kill: 'e3' } };
    assert.equal(isValidSubmission(challenge('kmk'), valid), true);
    assert.equal(isValidSubmission(challenge('kmk'), { ...valid, values: { Kiss: 'e1', Marry: 'e1', Kill: 'e3' } }), false);
  });

  it('requires Smash or Pass for every entry', () => {
    const valid = { mode: 'smash', values: { e1: 'Smash', e2: 'Pass' } };
    assert.equal(isValidSubmission(challenge('smash', 2), valid), true);
    assert.equal(isValidSubmission(challenge('smash', 2), { ...valid, values: { e1: 'Smash' } }), false);
    assert.equal(isValidSubmission(challenge('smash', 2), { ...valid, values: { ...valid.values, e2: 'Skip' } }), false);
  });

  it('requires Fact or Cap for every entry', () => {
    const valid = { mode: 'fact_cap', values: { e1: 'Fact', e2: 'Cap' } };
    assert.equal(isValidSubmission(challenge('fact_cap', 2), valid), true);
    assert.equal(isValidSubmission(challenge('fact_cap', 2), { ...valid, values: { e1: 'Fact' } }), false);
    assert.equal(isValidSubmission(challenge('fact_cap', 2), { ...valid, values: { ...valid.values, e2: 'Maybe' } }), false);
  });

  it('requires integer 1-10 rating for every entry', () => {
    const valid = { mode: 'rating', values: { e1: 10, e2: 7 } };
    assert.equal(isValidSubmission(challenge('rating', 2), valid), true);
    assert.equal(isValidSubmission(challenge('rating', 2), { ...valid, values: { e1: 10 } }), false);
    assert.equal(isValidSubmission(challenge('rating', 2), { ...valid, values: { e1: 10, e2: 12 } }), false);
    assert.equal(isValidSubmission(challenge('rating', 2), { ...valid, values: { e1: 10, e2: 0 } }), false);
    assert.equal(isValidSubmission(challenge('rating', 1), { mode: 'rating', values: { e1: 8 } }), true);
  });

  it('requires one champion result against every remaining Pick a Side entry', () => {
    assert.equal(isValidSubmission(challenge('versus', 4), { mode: 'versus', values: { e2: 'e1', e3: 'e3', e4: 'e3' } }), true);
    assert.equal(isValidSubmission(challenge('versus', 4), { mode: 'versus', values: { e2: 'e1', e3: 'e3' } }), false);
  });
});
