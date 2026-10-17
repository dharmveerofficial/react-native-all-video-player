import type { VideoPlayerProps } from './types';

/** The urls a player plays: its playlist's, or just `url`. */
export function playlistUrls(props: VideoPlayerProps): string[] {
  if (!props.playlist?.length) return [props.url ?? ''];
  return props.playlist.map(item => (typeof item === 'string' ? item : item.url));
}
