import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_COVER, nextCover } from '../src/thumbnailCover.ts';

const run = (onPause: boolean) => {
  let cover = INITIAL_COVER;
  return (state: number) => {
    cover = nextCover(cover, state as Parameters<typeof nextCover>[1], onPause);
    return cover.visible;
  };
};

test('shows before the first play and at the end, not on pause', () => {
  const step = run(false);
  assert.equal(INITIAL_COVER.visible, true);
  assert.equal(step(3), true);
  assert.equal(step(1), false);
  assert.equal(step(3), false);
  assert.equal(step(2), false);
  assert.equal(step(0), true);
  assert.equal(step(3), false);
});

test('onPause also covers pauses and holds through buffering', () => {
  const step = run(true);
  assert.equal(step(3), true);
  assert.equal(step(1), false);
  assert.equal(step(3), false);
  assert.equal(step(2), true);
  assert.equal(step(3), true);
  assert.equal(step(1), false);
  assert.equal(step(0), true);
});
