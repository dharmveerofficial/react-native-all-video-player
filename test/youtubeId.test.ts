import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidVideoId, youtubeId } from '../src/youtubeId.ts';

const ID = 'dQw4w9WgXcQ';

test('parses every common YouTube link form', () => {
  for (const url of [
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?feature=share&v=${ID}&t=42`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?si=abc`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}?rel=0`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/live/${ID}`,
    `  ${ID}  `,
  ]) {
    assert.equal(youtubeId(url), ID, url);
  }
});

test('rejects non-YouTube or malformed input', () => {
  for (const value of ['', 'hello', 'https://vimeo.com/123456', `https://youtu.be/${ID}x`, 'https://youtu.be/short']) {
    assert.equal(youtubeId(value), null, value);
  }
});

test('isValidVideoId only accepts 11 safe characters', () => {
  assert.equal(isValidVideoId(ID), true);
  assert.equal(isValidVideoId("abc'};alert"), false);
  assert.equal(isValidVideoId(`${ID}1`), false);
});
