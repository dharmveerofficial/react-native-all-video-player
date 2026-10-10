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

/** What to play: a single url, or a playlist (then url isn't needed). */
// The url variant comes last so leaving both out reports "Property 'url' is missing".
export type VideoSource =
  | {
      url?: string;
      /**
       * Videos to play in order; YouTube links and video files can be mixed. Used instead of
       * url: the player adds previous/next buttons and an "Autoplay next" switch in settings.
       */
      playlist: string[];
    }
  | {
      /** A YouTube link or id, or the http(s) URL of a video file or stream (mp4, m3u8, mpd, webm, mov, ...). */
      url: string;
      playlist?: string[];
    };

/** Pass url, or playlist; leaving both out is a type error. */
export type VideoPlayerProps = VideoSource & VideoPlayerOptions;

export interface VideoPlayerOptions {
  autoPlay?: boolean;
  startSeconds?: number;
  /** YouTube only: show the video's thumbnail before the first play and at the end. Default false. */
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
  /** Speeds under Settings > Playback speed. Default [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]; empty removes that row. */
  playbackRates?: number[];
  /** Default 10. Seconds each left/right double-tap seeks; 0 turns double-tap seeking off. */
  seekStepSeconds?: number;
  /**
   * Double-tap left or right of the center controls to seek by seekStepSeconds: from just past
   * the previous/next buttons in a playlist, otherwise just past play/pause. Default true.
   */
  doubleTapToSeek?: boolean;
  /** Seek bar and highlight color. Default '#EF4444'. */
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
  /** Playlists only: index of the video to start with. Default 0. */
  playlistStartIndex?: number;
  /** Playlists only: the player moved on to another video (index into playlist). */
  onVideoChange?: (index: number, url: string) => void;
  onError?: (error: PlayerError) => void;
  /**
   * Move a playing video into picture in picture when the user minimizes the app: Android 8+
   * for any source, iOS 14.2+ for video files and streams (not YouTube). Needs app setup;
   * see the README. Default true.
   */
  allowPictureInPicture?: boolean;
  onPictureInPictureChange?: (active: boolean) => void;
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
  /** Enter picture in picture, where it's available (see allowPictureInPicture). */
  enterPictureInPicture(): void;
}
