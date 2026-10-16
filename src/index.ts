import { registerMiniPlayer } from './components/MiniPlayerRoot';

export { VideoPlayer } from './components/VideoPlayer';
export { PlayerState } from './types';
export type {
  PlayerError,
  PlaylistItem,
  ProgressEvent,
  VideoPlayerOptions,
  VideoPlayerProps,
  VideoPlayerRef,
  VideoSource,
} from './types';
export { isValidVideoId, youtubeId } from './youtubeId';
export { resolveSource, type ResolvedSource } from './source';
export { formatTime } from './formatTime';

// The mini player's own React surface, which native code lays over the app when a player is
// swiped down; no app setup needed.
registerMiniPlayer();
