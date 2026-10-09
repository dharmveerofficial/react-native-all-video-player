import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSource } from '../src/source.ts';

test('YouTube ids and links play through YouTube', () => {
  assert.deepEqual(resolveSource('dQw4w9WgXcQ'), { kind: 'youtube', videoId: 'dQw4w9WgXcQ' });
  assert.deepEqual(resolveSource('https://youtu.be/dQw4w9WgXcQ?si=x'), { kind: 'youtube', videoId: 'dQw4w9WgXcQ' });
  assert.deepEqual(resolveSource('https://www.youtube.com/shorts/dQw4w9WgXcQ'), { kind: 'youtube', videoId: 'dQw4w9WgXcQ' });
});

test('any other http(s) URL plays natively', () => {
  for (const url of [
    'https://cdn.example.com/a/b.mp4',
    'https://stream.example.com/live/index.m3u8',
    'https://cdn.example.com/manifest.mpd',
    'HTTPS://Bucket.S3.Amazonaws.com/v.mov',
    'http://192.168.1.14:4000/api/course-contents/abc/stream?token=1.x',
  ]) {
    assert.deepEqual(resolveSource(`  ${url}  `), { kind: 'video', url }, url);
  }
});

test('anything else is rejected', () => {
  for (const value of ['', 'not a url', 'ftp://host/v.mp4', 'file:///sdcard/v.mp4', 'javascript:alert(1)', 'https://a.com/x y.mp4']) {
    assert.equal(resolveSource(value), null, value);
  }
});
