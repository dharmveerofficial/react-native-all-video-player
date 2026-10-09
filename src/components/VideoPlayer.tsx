import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import { formatTime } from '../formatTime';
import { resolveSource } from '../source';
import { PlayerState, type PlayerError, type VideoPlayerProps, type VideoPlayerRef } from '../types';
import { useFullscreenOrientation } from '../useFullscreenOrientation';
import { NativeVideoEngine, YouTubeEngine, type EngineHandle, type EngineProps } from './engines';
import { FullscreenIcon, PauseIcon, PlayIcon, ReplayIcon, SkipIcon } from './icons';

const DEFAULT_RATES = [1, 1.25, 1.5, 2];
const CONTROLS_HIDE_DELAY_MS = 3000;
const WHITE = '#FFFFFF';
const BLACK = '#000000';

type SurfaceProps = Omit<VideoPlayerProps, 'onFullscreenChange' | 'allowFullscreen'> & {
  fullscreen: boolean;
  onToggleFullscreen?: () => void;
};

const PlayerSurface = forwardRef<VideoPlayerRef, SurfaceProps>(function PlayerSurface(
  {
    url,
    autoPlay = false,
    startSeconds = 0,
    hideYouTubeBranding = true,
    showControls = true,
    playbackRates = DEFAULT_RATES,
    seekStepSeconds = 10,
    accentColor = '#7C3AED',
    fullscreen,
    onToggleFullscreen,
    style,
    renderLoading,
    onReady,
    onStateChange,
    onProgress,
    onEnd,
    onError,
  },
  ref,
) {
  const resolved = useMemo(() => resolveSource(url ?? ''), [url]);
  const engineRef = useRef<EngineHandle>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeRef = useRef({ current: 0, duration: 0 });
  const draggingRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<PlayerState>(PlayerState.Unstarted);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [trackWidth, setTrackWidth] = useState(0);
  const [dragFraction, setDragFraction] = useState<number | null>(null);

  const playing = state === PlayerState.Playing;
  const buffering = state === PlayerState.Buffering;
  const ended = state === PlayerState.Ended;

  useEffect(() => {
    setReady(false);
    setState(PlayerState.Unstarted);
    setCurrent(0);
    setDuration(0);
    setRate(1);
    timeRef.current = { current: 0, duration: 0 };
    if (!resolved) onError?.({ message: 'Not a YouTube link or a video URL' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved]);

  const clearHideTimer = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = null;
  };

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    clearHideTimer();
    hideTimer.current = setTimeout(() => setControlsVisible(false), CONTROLS_HIDE_DELAY_MS);
  }, []);

  useEffect(() => {
    if (playing) {
      revealControls();
    } else {
      clearHideTimer();
      setControlsVisible(true);
    }
  }, [playing, revealControls]);

  useEffect(() => clearHideTimer, []);

  const seekTo = useCallback((seconds: number) => {
    const max = timeRef.current.duration || seconds;
    const target = Math.min(Math.max(0, seconds), max);
    setCurrent(target);
    timeRef.current.current = target;
    engineRef.current?.seekTo(target);
  }, []);

  const changeRate = useCallback((next: number) => {
    setRate(next);
    engineRef.current?.setRate(next);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      play: () => engineRef.current?.play(),
      pause: () => engineRef.current?.pause(),
      seekTo,
      setPlaybackRate: changeRate,
      mute: () => engineRef.current?.setMuted(true),
      unMute: () => engineRef.current?.setMuted(false),
      getCurrentTime: () => timeRef.current.current,
      getDuration: () => timeRef.current.duration,
      setFullscreen: () => {},
    }),
    [seekTo, changeRate],
  );

  const engineProps: EngineProps = {
    startSeconds,
    style: StyleSheet.absoluteFill,
    onReady: total => {
      setReady(true);
      setDuration(total);
      timeRef.current.duration = total;
      onReady?.({ duration: total });
      if (autoPlay) engineRef.current?.play();
    },
    onState: next => {
      setState(next);
      onStateChange?.(next);
      if (next === PlayerState.Ended) onEnd?.();
    },
    onTime: (time, reported) => {
      const total = reported || timeRef.current.duration;
      timeRef.current = { current: time, duration: total };
      if (!draggingRef.current) setCurrent(time);
      if (total) setDuration(total);
      onProgress?.({ currentTime: time, duration: total });
    },
    onError: (error: PlayerError) => onError?.(error),
  };

  const onTap = () => {
    if (!showControls) return;
    if (controlsVisible && playing) {
      clearHideTimer();
      setControlsVisible(false);
    } else {
      revealControls();
    }
  };

  const togglePlay = () => {
    if (ended) {
      seekTo(0);
      engineRef.current?.play();
    } else if (playing) {
      engineRef.current?.pause();
    } else {
      engineRef.current?.play();
    }
    revealControls();
  };

  const skip = (delta: number) => {
    seekTo(timeRef.current.current + delta);
    revealControls();
  };

  const cycleRate = () => {
    if (playbackRates.length === 0) return;
    changeRate(playbackRates[(playbackRates.indexOf(rate) + 1) % playbackRates.length]);
    revealControls();
  };

  const fractionAt = (event: GestureResponderEvent) =>
    trackWidth > 0 ? Math.min(1, Math.max(0, event.nativeEvent.locationX / trackWidth)) : 0;

  const endDrag = () => {
    draggingRef.current = false;
    setDragFraction(null);
  };

  const progress = dragFraction ?? (duration > 0 ? current / duration : 0);

  if (!resolved) {
    return <View style={[styles.container, style]} />;
  }

  return (
    <View style={[styles.container, style]}>
      {resolved.kind === 'youtube' ? (
        <YouTubeEngine
          key={resolved.videoId}
          ref={engineRef}
          videoId={resolved.videoId}
          hideBranding={hideYouTubeBranding}
          {...engineProps}
        />
      ) : (
        <NativeVideoEngine key={resolved.url} ref={engineRef} url={resolved.url} {...engineProps} />
      )}

      <Pressable style={StyleSheet.absoluteFill} onPress={onTap} accessible={false} />

      {(!ready || buffering) && (
        <View style={styles.centerOverlay} pointerEvents="none">
          {renderLoading ? renderLoading() : <ActivityIndicator color={WHITE} size="large" />}
        </View>
      )}

      {showControls && ready && controlsVisible && (
        <View style={styles.controls} pointerEvents="box-none">
          <View style={styles.centerRow} pointerEvents="box-none">
            {seekStepSeconds > 0 && (
              <TouchableOpacity
                style={styles.skipButton}
                onPress={() => skip(-seekStepSeconds)}
                accessibilityRole="button"
                accessibilityLabel={`Back ${seekStepSeconds} seconds`}
              >
                <SkipIcon size={36} color={WHITE} seconds={seekStepSeconds} forward={false} />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.playButton}
              onPress={togglePlay}
              accessibilityRole="button"
              accessibilityLabel={ended ? 'Replay' : playing ? 'Pause' : 'Play'}
            >
              {ended ? (
                <ReplayIcon size={30} color={WHITE} />
              ) : playing ? (
                <PauseIcon size={24} color={WHITE} />
              ) : (
                <PlayIcon size={26} color={WHITE} />
              )}
            </TouchableOpacity>
            {seekStepSeconds > 0 && (
              <TouchableOpacity
                style={styles.skipButton}
                onPress={() => skip(seekStepSeconds)}
                accessibilityRole="button"
                accessibilityLabel={`Forward ${seekStepSeconds} seconds`}
              >
                <SkipIcon size={36} color={WHITE} seconds={seekStepSeconds} forward />
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.bottomBar}>
            <Text style={styles.time}>{formatTime(dragFraction !== null ? dragFraction * duration : current)}</Text>
            <View
              style={styles.trackTouchArea}
              onLayout={(e: LayoutChangeEvent) => setTrackWidth(e.nativeEvent.layout.width)}
              onStartShouldSetResponder={() => true}
              onMoveShouldSetResponder={() => true}
              onResponderGrant={e => {
                clearHideTimer();
                draggingRef.current = true;
                setDragFraction(fractionAt(e));
              }}
              onResponderMove={e => setDragFraction(fractionAt(e))}
              onResponderRelease={e => {
                const fraction = fractionAt(e);
                endDrag();
                seekTo(fraction * duration);
                revealControls();
              }}
              onResponderTerminate={endDrag}
              accessibilityRole="adjustable"
              accessibilityLabel="Seek"
              accessibilityValue={{ min: 0, max: Math.round(duration), now: Math.round(current) }}
            >
              <View style={styles.track} pointerEvents="none">
                <View style={[styles.trackFill, { width: `${progress * 100}%`, backgroundColor: accentColor }]} />
              </View>
              <View style={[styles.thumb, { left: progress * trackWidth - 7 }]} pointerEvents="none" />
            </View>
            <Text style={styles.time}>{formatTime(duration)}</Text>
            {playbackRates.length > 0 && (
              <TouchableOpacity
                style={styles.rateButton}
                onPress={cycleRate}
                accessibilityRole="button"
                accessibilityLabel="Playback speed"
              >
                <Text style={styles.rateText}>{rate}x</Text>
              </TouchableOpacity>
            )}
            {onToggleFullscreen && (
              <TouchableOpacity
                style={styles.fullscreenButton}
                onPress={() => {
                  onToggleFullscreen();
                  revealControls();
                }}
                accessibilityRole="button"
                accessibilityLabel={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              >
                <FullscreenIcon size={18} color={WHITE} exit={fullscreen} />
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}
    </View>
  );
});

/**
 * Fullscreen opens a second player in a Modal that resumes where the inline one
 * was; the inline player waits paused underneath and takes over again on exit.
 */
export const VideoPlayer = forwardRef<VideoPlayerRef, VideoPlayerProps>(function VideoPlayer(
  { onFullscreenChange, allowFullscreen = true, style, onStateChange, onProgress, onEnd, ...surfaceProps },
  ref,
) {
  const [fullscreen, setFullscreenState] = useState(false);
  const inlineRef = useRef<VideoPlayerRef>(null);
  const modalRef = useRef<VideoPlayerRef>(null);
  const inlineState = useRef<PlayerState>(PlayerState.Unstarted);
  const modalState = useRef<PlayerState>(PlayerState.Unstarted);
  const [resume, setResume] = useState({ seconds: 0, playing: false });

  useFullscreenOrientation(fullscreen);

  const setFullscreen = useCallback(
    (next: boolean) => {
      if (next === fullscreen) return;
      if (next) {
        setResume({
          seconds: inlineRef.current?.getCurrentTime() ?? 0,
          playing: inlineState.current === PlayerState.Playing,
        });
        modalState.current = PlayerState.Unstarted;
        inlineRef.current?.pause();
      } else {
        const modal = modalRef.current;
        if (modal) inlineRef.current?.seekTo(modal.getCurrentTime());
        if (modalState.current === PlayerState.Playing) inlineRef.current?.play();
      }
      setFullscreenState(next);
      onFullscreenChange?.(next);
    },
    [fullscreen, onFullscreenChange],
  );

  useImperativeHandle(
    ref,
    () => {
      const active = () => (fullscreen ? modalRef : inlineRef).current;
      return {
        play: () => active()?.play(),
        pause: () => active()?.pause(),
        seekTo: seconds => active()?.seekTo(seconds),
        setPlaybackRate: next => active()?.setPlaybackRate(next),
        mute: () => active()?.mute(),
        unMute: () => active()?.unMute(),
        getCurrentTime: () => active()?.getCurrentTime() ?? 0,
        getDuration: () => active()?.getDuration() ?? 0,
        setFullscreen,
      };
    },
    [fullscreen, setFullscreen],
  );

  const toggleFullscreen = allowFullscreen ? () => setFullscreen(!fullscreen) : undefined;

  return (
    <>
      {fullscreen && <StatusBar hidden animated />}
      <PlayerSurface
        {...surfaceProps}
        ref={inlineRef}
        style={style}
        fullscreen={false}
        onToggleFullscreen={toggleFullscreen}
        onStateChange={next => {
          inlineState.current = next;
          if (!fullscreen) onStateChange?.(next);
        }}
        onProgress={event => !fullscreen && onProgress?.(event)}
        onEnd={() => !fullscreen && onEnd?.()}
      />
      {fullscreen && (
        <Modal
          visible
          animationType="fade"
          statusBarTranslucent
          supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
          onRequestClose={() => setFullscreen(false)}
        >
          <PlayerSurface
            {...surfaceProps}
            ref={modalRef}
            style={StyleSheet.absoluteFill}
            startSeconds={resume.seconds}
            autoPlay={resume.playing}
            fullscreen
            onToggleFullscreen={toggleFullscreen}
            onReady={undefined}
            onStateChange={next => {
              modalState.current = next;
              onStateChange?.(next);
            }}
            onProgress={onProgress}
            onEnd={onEnd}
          />
        </Modal>
      )}
    </>
  );
});

const styles = StyleSheet.create({
  container: { backgroundColor: BLACK, overflow: 'hidden' },
  centerOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controls: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  centerRow: {
    ...StyleSheet.absoluteFill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 28,
  },
  skipButton: { padding: 8 },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  time: { color: WHITE, fontSize: 12, fontWeight: '600', minWidth: 38, textAlign: 'center' },
  trackTouchArea: { flex: 1, height: 28, justifyContent: 'center', marginHorizontal: 8 },
  track: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.38)', overflow: 'hidden' },
  trackFill: { height: 4 },
  thumb: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: WHITE,
  },
  rateButton: {
    marginLeft: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.92)',
  },
  rateText: { color: WHITE, fontSize: 12, fontWeight: '700' },
  fullscreenButton: { marginLeft: 10, padding: 3 },
});
