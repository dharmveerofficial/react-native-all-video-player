import type * as React from 'react';
import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef } from 'react';
import type { NativeSyntheticEvent, StyleProp, ViewStyle } from 'react-native';
import AVPVideoView, { Commands as VideoCommands } from '../specs/AVPVideoViewNativeComponent';
import AVPWebView, { Commands as WebViewCommands } from '../specs/AVPWebViewNativeComponent';
import { PlayerState, type PlayerError } from '../types';
import { YOUTUBE_ERROR_MESSAGES, youtubeHtml } from '../youtubeHtml';

export interface EngineHandle {
  play(): void;
  pause(): void;
  seekTo(seconds: number): void;
  setRate(rate: number): void;
  setMuted(muted: boolean): void;
  /** iOS video files only; a no-op elsewhere. */
  startPictureInPicture(): void;
}

export interface EngineProps {
  startSeconds: number;
  style?: StyleProp<ViewStyle>;
  onReady(duration: number): void;
  onState(state: PlayerState): void;
  onTime(currentTime: number, duration: number): void;
  onError(error: PlayerError): void;
}

// YouTube refuses embeds without a referring https origin; any one works.
const EMBED_ORIGIN = 'https://localhost';

interface PageMessage {
  type: 'ready' | 'state' | 'time' | 'error';
  state?: number;
  current?: number;
  duration?: number;
  code?: number;
  message?: string;
}

type YouTubeEngineProps = EngineProps & {
  videoId: string;
  hideBranding: boolean;
  thumbnailOnPause: boolean;
  thumbnail?: string;
  /** Play as soon as it loads; read once, so changing it later doesn't reload the page. */
  autoPlay: boolean;
};

export const YouTubeEngine = forwardRef<EngineHandle, YouTubeEngineProps>(
  function YouTubeEngine(
    { videoId, hideBranding, thumbnailOnPause, thumbnail, autoPlay, startSeconds, style, onReady, onState, onTime, onError },
    ref,
  ) {
    const viewRef = useRef<React.ElementRef<typeof AVPWebView>>(null);
    const playOnLoad = useRef(autoPlay).current;
    const html = useMemo(
      () => youtubeHtml({ videoId, origin: EMBED_ORIGIN, startSeconds, hideBranding, thumbnailOnPause, thumbnail, autoPlay: playOnLoad }),
      [videoId, startSeconds, hideBranding, thumbnailOnPause, thumbnail, playOnLoad],
    );

    const run = useCallback((script: string) => {
      if (viewRef.current) WebViewCommands.injectJavaScript(viewRef.current, `if (player && ready) { ${script} }`);
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        play: () => run('player.playVideo();'),
        pause: () => run('player.pauseVideo();'),
        seekTo: seconds => run(`player.seekTo(${Number(seconds) || 0}, true);`),
        setRate: rate => run(`player.setPlaybackRate(${Number(rate) || 1});`),
        setMuted: muted => run(muted ? 'player.mute();' : 'player.unMute();'),
        startPictureInPicture: () => {},
      }),
      [run],
    );

    const onMessage = (event: NativeSyntheticEvent<{ data: string }>) => {
      let message: PageMessage;
      try {
        message = JSON.parse(event.nativeEvent.data);
      } catch {
        return;
      }
      switch (message.type) {
        case 'ready':
          onReady(message.duration ?? 0);
          break;
        case 'state':
          onState((message.state ?? PlayerState.Unstarted) as PlayerState);
          break;
        case 'time':
          onTime(message.current ?? 0, message.duration ?? 0);
          break;
        case 'error':
          onError({
            code: message.code,
            message:
              (message.code !== undefined && YOUTUBE_ERROR_MESSAGES[message.code]) ||
              message.message ||
              'The video could not be played',
          });
          break;
      }
    };

    return (
      <AVPWebView
        ref={viewRef}
        style={style}
        html={html}
        baseUrl={EMBED_ORIGIN}
        onMessage={onMessage}
        onLoadError={() => onError({ message: 'The YouTube player failed to load' })}
      />
    );
  },
);

type NativeVideoEngineProps = EngineProps & {
  url: string;
  /** Grab a frame from the video to use as its thumbnail. */
  grabPoster: boolean;
  onPoster(uri: string): void;
  /** iOS: allow picture in picture, and start it by itself when the app goes to the background. */
  pictureInPicture: boolean;
  autoEnterPictureInPicture: boolean;
  onPictureInPicturePossible(possible: boolean): void;
  onPictureInPicture(active: boolean): void;
};

export const NativeVideoEngine = forwardRef<EngineHandle, NativeVideoEngineProps>(function NativeVideoEngine(
  {
    url,
    grabPoster,
    pictureInPicture,
    autoEnterPictureInPicture,
    startSeconds,
    style,
    onReady,
    onState,
    onTime,
    onError,
    onPoster,
    onPictureInPicturePossible,
    onPictureInPicture,
  },
  ref,
) {
  const viewRef = useRef<React.ElementRef<typeof AVPVideoView>>(null);
  const call = useCallback((fn: (view: React.ElementRef<typeof AVPVideoView>) => void) => {
    if (viewRef.current) fn(viewRef.current);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      play: () => call(view => VideoCommands.play(view)),
      pause: () => call(view => VideoCommands.pause(view)),
      seekTo: seconds => call(view => VideoCommands.seekTo(view, Math.max(0, Number(seconds) || 0))),
      setRate: rate => call(view => VideoCommands.setRate(view, Number(rate) || 1)),
      setMuted: muted => call(view => VideoCommands.setMuted(view, muted)),
      startPictureInPicture: () => call(view => VideoCommands.startPictureInPicture(view)),
    }),
    [call],
  );

  return (
    <AVPVideoView
      ref={viewRef}
      style={style}
      source={url}
      grabPoster={grabPoster}
      pictureInPicture={pictureInPicture}
      autoEnterPictureInPicture={autoEnterPictureInPicture}
      onVideoReady={e => {
        if (startSeconds > 0) call(view => VideoCommands.seekTo(view, startSeconds));
        onReady(e.nativeEvent.duration);
      }}
      onVideoState={e => onState(e.nativeEvent.state as PlayerState)}
      onVideoProgress={e => onTime(e.nativeEvent.currentTime, e.nativeEvent.duration)}
      onVideoError={e => onError({ message: e.nativeEvent.message || 'The video could not be played' })}
      onVideoPoster={e => onPoster(e.nativeEvent.uri)}
      onVideoPictureInPicturePossible={e => onPictureInPicturePossible(e.nativeEvent.possible)}
      onVideoPictureInPicture={e => onPictureInPicture(e.nativeEvent.active)}
    />
  );
});
