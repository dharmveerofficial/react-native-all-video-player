const VIDEO_ID = /^[\w-]{11}$/;

const URL_PATTERNS = [
  /youtu\.be\/([\w-]{11})(?![\w-])/,
  /youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/|v\/)([\w-]{11})(?![\w-])/,
];

export function isValidVideoId(value: string): boolean {
  return VIDEO_ID.test(value);
}

/** The video id from any common YouTube link (or a bare id), else null. */
export function youtubeId(urlOrId: string): string | null {
  const value = urlOrId.trim();
  if (isValidVideoId(value)) return value;
  for (const pattern of URL_PATTERNS) {
    const match = value.match(pattern);
    if (match) return match[1];
  }
  return null;
}
