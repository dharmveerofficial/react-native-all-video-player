import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTime } from '../src/formatTime.ts';

test('formats minutes and hours', () => {
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(9.9), '0:09');
  assert.equal(formatTime(75), '1:15');
  assert.equal(formatTime(3600), '1:00:00');
  assert.equal(formatTime(3725), '1:02:05');
});

test('treats bad input as zero', () => {
  assert.equal(formatTime(-5), '0:00');
  assert.equal(formatTime(Number.NaN), '0:00');
  assert.equal(formatTime(Number.POSITIVE_INFINITY), '0:00');
});
