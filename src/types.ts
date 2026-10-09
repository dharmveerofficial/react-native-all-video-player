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
   * YouTube only: clip YouTube's overlays and cover its start/end screens.
   * Default true. YouTube's API terms don't allow obscuring its branding.
   */
  hideYouTubeBranding?: boolean;
  /** Default true; false gives a bare player driven via the ref. */
  showControls?: boolean;
  /** Default [1, 1.25, 1.5, 2]; empty hides the speed button. */
  playbackRates?: number[];
  /** Default 10; 0 hides the skip buttons. */
  seekStepSeconds?: number;
  /** Seek bar color. Default '#7C3AED'. */
  accentColor?: string;
  /** Default true. */
  allowFullscreen?: boolean;
  onFullscreenChange?: (fullscreen: boolean) => void;
  style?: StyleProp<ViewStyle>;
  renderLoading?: () => ReactNode;
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
