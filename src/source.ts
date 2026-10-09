import { youtubeId } from './youtubeId.ts';

export type ResolvedSource = { kind: 'youtube'; videoId: string } | { kind: 'video'; url: string };

const HTTP_URL = /^https?:\/\/[^/?#\s]+/i;

/** YouTube ids/links play through YouTube; any other http(s) URL plays natively. */
export function resolveSource(value: string): ResolvedSource | null {
  const trimmed = value.trim();
  const id = youtubeId(trimmed);
  if (id) return { kind: 'youtube', videoId: id };
  if (!HTTP_URL.test(trimmed) || /\s/.test(trimmed)) return null;
  return { kind: 'video', url: trimmed };
}
