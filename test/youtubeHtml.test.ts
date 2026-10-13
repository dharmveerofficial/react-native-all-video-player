import { test } from 'node:test';
import assert from 'node:assert/strict';
import { youtubeHtml } from '../src/youtubeHtml.ts';

const base = {
  videoId: 'dQw4w9WgXcQ',
  origin: 'https://localhost',
  startSeconds: 0,
  hideBranding: true,
  thumbnailOnPause: false,
  thumbnail: 'https://cdn.example.com/poster.jpg' as string | undefined,
};

test('turns off YouTube controls and keeps the player inline', () => {
  const html = youtubeHtml(base);
  assert.match(html, /controls: 0/);
  assert.match(html, /playsinline: 1/);
  assert.match(html, /videoId: 'dQw4w9WgXcQ'/);
  assert.match(html, /origin: "https:\/\/localhost"/);
});

test('sizes the player, cover and shield in px from the window, and on resize', () => {
  const html = youtubeHtml(base);
  assert.match(html, /'#player,#cover,#shield\{width:' \+ w \+ 'px;height:' \+ h \+ 'px\}'/);
  assert.match(html, /addEventListener\('resize', layout\)/);
});

test('does not report unrelated page script errors', () => {
  assert.doesNotMatch(youtubeHtml(base), /window\.onerror/);
});

test('hideBranding only marks the iframe for the native WebView; it adds no cover', () => {
  assert.match(youtubeHtml(base), /avp_hide_branding: 1 \}/);
  assert.match(youtubeHtml({ ...base, hideBranding: false }), /avp_hide_branding: 0 \}/);
  assert.match(youtubeHtml({ ...base, thumbnail: undefined }), /<div id="cover" class="hidden">/);
});

test('start time is clamped to whole non-negative seconds', () => {
  assert.match(youtubeHtml({ ...base, startSeconds: 12.7 }), /start: 12,/);
  assert.match(youtubeHtml({ ...base, startSeconds: -3 }), /start: 0,/);
});

const coverSteps = (options: Partial<typeof base>) => {
  const cover = { className: '' };
  const src = youtubeHtml({ ...base, ...options }).match(/function updateCover[\s\S]*?\n}/)![0];
  const fn = new Function('cover', `var hasPlayed = false; ${src}; return updateCover;`)(cover) as (
    state: number,
  ) => void;
  return (state: number) => (fn(state), cover.className);
};

test('thumbnail cover shows before the first play and at the end, not on pause', () => {
  const step = coverSteps({});
  assert.equal(step(5), '');
  assert.equal(step(3), '');
  assert.equal(step(1), 'hidden');
  assert.equal(step(3), 'hidden');
  assert.equal(step(2), 'hidden');
  assert.equal(step(1), 'hidden');
  assert.equal(step(0), '');
  assert.equal(step(3), 'hidden');
  assert.equal(coverSteps({ thumbnail: undefined })(0), 'hidden');
});

test('thumbnailOnPause also covers pauses, and holds through buffering', () => {
  const step = coverSteps({ thumbnailOnPause: true });
  assert.equal(step(5), '');
  assert.equal(step(3), '');
  assert.equal(step(1), 'hidden');
  assert.equal(step(3), 'hidden');
  assert.equal(step(2), '');
  assert.equal(step(3), '');
  assert.equal(step(1), 'hidden');
  assert.equal(step(0), '');
  assert.equal(coverSteps({ thumbnail: undefined, thumbnailOnPause: true })(2), 'hidden');
});

test('a thumbnail turns the cover on, with or without hideBranding', () => {
  const html = youtubeHtml({ ...base, hideBranding: false });
  assert.match(html, /url\("https:\/\/cdn\.example\.com\/poster\.jpg"\)/);
  assert.match(html, /<div id="cover"><\/div>/);
  assert.equal(coverSteps({ hideBranding: false })(0), '');
});

test('thumbnail URL cannot break out of the CSS url()', () => {
  const html = youtubeHtml({ ...base, thumbnail: 'https://x/a".jpg)</style><script>alert(1)</script>' });
  assert.doesNotMatch(html, /<\/style><script>alert/);
  assert.match(html, /a%22\.jpg%29%3C\/style%3E%3Cscript%3Ealert%281%29%3C\/script%3E/);
});

test('autoPlay starts the video from inside the page once the player is ready', () => {
  assert.match(youtubeHtml({ ...base, autoPlay: true }), /if \(true\) player\.playVideo\(\);/);
  assert.match(youtubeHtml(base), /if \(false\) player\.playVideo\(\);/);
});
