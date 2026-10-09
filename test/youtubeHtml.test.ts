import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYER_FRAME_JS, youtubeHtml } from '../src/youtubeHtml.ts';

const base = { videoId: 'dQw4w9WgXcQ', origin: 'https://localhost', startSeconds: 0, hideBranding: true };

type Frame = { left: number; top: number; width: number; height: number };
const playerFrame = new Function(`${PLAYER_FRAME_JS}; return playerFrame;`)() as (
  boxWidth: number,
  boxHeight: number,
  cropEdges: boolean,
) => Frame;

test('turns off YouTube controls and keeps the player inline', () => {
  const html = youtubeHtml(base);
  assert.match(html, /controls: 0/);
  assert.match(html, /playsinline: 1/);
  assert.match(html, /videoId: 'dQw4w9WgXcQ'/);
  assert.match(html, /origin: "https:\/\/localhost"/);
});

test('lays the player out from the box size and on resize', () => {
  const html = youtubeHtml(base);
  assert.match(html, /playerFrame\(window.innerWidth, window.innerHeight, true\)/);
  assert.match(html, /addEventListener\('resize', layout\)/);
  assert.match(youtubeHtml({ ...base, hideBranding: false }), /window.innerHeight, false\)/);
});

test('does not report unrelated page script errors', () => {
  assert.doesNotMatch(youtubeHtml(base), /window\.onerror/);
});

test('crop scales with the box: ~120px for a phone-width 16:9 box', () => {
  assert.deepEqual(playerFrame(360, 202.5, true), { left: 0, top: -122, width: 360, height: 447 });
});

test('crop stays within 80-240px', () => {
  assert.equal(playerFrame(160, 90, true).top, -80);
  assert.equal(playerFrame(1920, 1080, true).top, -240);
});

test('wide box: player matches the pillarboxed video width, centered', () => {
  assert.deepEqual(playerFrame(900, 300, true), { left: 183, top: -180, width: 533, height: 660 });
});

test('tall box: player keeps full width and the video stays centered', () => {
  const f = playerFrame(360, 640, true);
  assert.equal(f.width, 360);
  assert.equal(f.top + f.height / 2, 320);
});

test('no crop, or no size yet, fills the box', () => {
  assert.deepEqual(playerFrame(360, 202, false), { left: 0, top: 0, width: 360, height: 202 });
  assert.deepEqual(playerFrame(0, 0, true), { left: 0, top: 0, width: 0, height: 0 });
});

test('thumbnail cover follows hideBranding', () => {
  assert.match(youtubeHtml(base), /<div id="cover"><\/div>/);
  assert.match(youtubeHtml({ ...base, hideBranding: false }), /<div id="cover" class="hidden">/);
});

test('start time is clamped to whole non-negative seconds', () => {
  assert.match(youtubeHtml({ ...base, startSeconds: 12.7 }), /start: 12,/);
  assert.match(youtubeHtml({ ...base, startSeconds: -3 }), /start: 0,/);
});
