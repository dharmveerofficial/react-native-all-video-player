import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

export const PlayerState = {
  Unstarted: -1,
  Ended: 0,
  Playing: 1,
  Paused: 2,
  Buffering: 3,
  Cued: 5,
} as const;

export type PlayerState = (typeof PlayerState)[keyof typeof PlayerState];

export interface PlayerError {
  /** YouTube's error code (2, 5, 100, 101, 150, 152, 153); undefined for other sources. */
  code?: number;
  message: string;
}

export interface ProgressEvent {
  currentTime: number;
  duration: number;
}

export interface VideoPlayerProps {
  /** A YouTube link or id, or the http(s) URL of a video file or stream (mp4, m3u8, mpd, webm, mov, ...). */
  url: string;
  autoPlay?: boolean;
  startSeconds?: number;
  /**
   * YouTube only: clip YouTube's overlays and cover its start and end screens with the thumbnail.
   * Default false. YouTube's API terms don't allow obscuring its branding.
   */
  hideYouTubeBranding?: boolean;
  /**
   * Image URL shown over the video before the first play and after the end, for any
   * source. Without one, YouTube uses the video's own thumbnail (when hideYouTubeBranding
   * is on) and video files use a frame grabbed from the video, skipping blank ones (not for HLS/DASH streams).
   */
  thumbnail?: string;
  /** Also show the thumbnail while paused mid-video. Default false. */
  thumbnailOnPause?: boolean;
  /** Default true; false gives a bare player driven via the ref. */
  showControls?: boolean;
  /** Speeds listed in the speed menu. Default [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]; empty hides the speed button. */
  playbackRates?: number[];
  /** Default 10. Step for the skip buttons and left/right double-tap; 0 turns both off. */
  seekStepSeconds?: number;
  /** Double-tap left or right of the center controls to seek by seekStepSeconds. Default true. */
  doubleTapToSeek?: boolean;
  /** Seek bar color. Default '#7C3AED'. */
  accentColor?: string;
  /** Default true. */
  allowFullscreen?: boolean;
  onFullscreenChange?: (fullscreen: boolean) => void;
  style?: StyleProp<ViewStyle>;
  renderLoading?: () => ReactNode;
  /**
   * Replaces the fullscreen back button. Rendered over the player while the controls show;
   * position it yourself (e.g. absolute, top-left). Return null to hide the button.
   */
  renderBackButton?: (props: { exitFullscreen: () => void }) => ReactNode;
  onReady?: (info: { duration: number }) => void;
  onStateChange?: (state: PlayerState) => void;
  /** About twice a second. */
  onProgress?: (event: ProgressEvent) => void;
  onEnd?: () => void;
  onError?: (error: PlayerError) => void;
}

export interface VideoPlayerRef {
  play(): void;
  pause(): void;
  seekTo(seconds: number): void;
  setPlaybackRate(rate: number): void;
  mute(): void;
  unMute(): void;
  getCurrentTime(): number;
  getDuration(): number;
  setFullscreen(fullscreen: boolean): void;
}
