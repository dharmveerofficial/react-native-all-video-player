import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Modal,
  Pressable,
  ScrollView,
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
import { INITIAL_COVER, nextCover } from '../thumbnailCover';
import { PlayerState, type PlayerError, type VideoPlayerProps, type VideoPlayerRef } from '../types';
import { useFullscreenOrientation } from '../useFullscreenOrientation';
import { NativeVideoEngine, YouTubeEngine, type EngineHandle, type EngineProps } from './engines';
import { BackIcon, FullscreenIcon, PauseIcon, PlayIcon, ReplayIcon, SkipIcon } from './icons';

const DEFAULT_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const CONTROLS_HIDE_DELAY_MS = 3000;
const RATE_OPTION_HEIGHT = 36;
const DOUBLE_TAP_MS = 280;
// Double-tap seeks only beside the center controls: the outer 35% of the width on each
// side, within the middle half of the height (taps above or below just toggle controls).
const SIDE_ZONE = 0.35;
const SIDE_ZONE_HEIGHT = 0.4;
const WHITE = '#FFFFFF';
const BLACK = '#000000';

// A "+10" / "-10" label that drifts out toward its direction and fades. Bumping it again
// before it fades adds to the total, so quick repeat skips read "+20", "+30"...
function useDriftLabel(forward: boolean) {
  const drift = useRef(new Animated.Value(0)).current;
  const streak = useRef(0);
  const [shown, setShown] = useState(0);

  const bump = useCallback(
    (seconds: number) => {
      streak.current += seconds;
      setShown(streak.current);
      // Interrupting reports finished=false, so the streak only resets once the label fades out.
      drift.stopAnimation();
      drift.setValue(0);
      Animated.timing(drift, { toValue: 1, duration: 750, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(
        ({ finished }) => {
          if (!finished) return;
          streak.current = 0;
          setShown(0);
        },
      );
    },
    [drift],
  );

  const style = {
    opacity: drift.interpolate({ inputRange: [0, 0.15, 0.6, 1], outputRange: [0, 1, 1, 0] }),
    transform: [{ translateX: drift.interpolate({ inputRange: [0, 1], outputRange: [0, forward ? 28 : -28] }) }],
  };
  const text = `${forward ? '+' : '-'}${shown}`;
  return { shown, bump, style, text };
}

type SideFeedbackHandle = { bump: (seconds: number) => void };

// Double-tap feedback over the left or right side of the video, shown even with controls hidden.
const SideSeekFeedback = forwardRef<SideFeedbackHandle, { forward: boolean }>(
  function SideSeekFeedback({ forward }, ref) {
    const label = useDriftLabel(forward);
    useImperativeHandle(ref, () => ({ bump: label.bump }), [label.bump]);
    if (label.shown === 0) return null;
    return (
      <View pointerEvents="none" style={[styles.sideFeedback, forward ? { right: 0 } : { left: 0 }]}>
        <Animated.View style={[styles.sideFeedbackInner, label.style]}>
          <Text style={styles.skipLabelText}>{label.text}</Text>
        </Animated.View>
      </View>
    );
  },
);

// Spins the arrow toward its direction with a small pulse, then springs back, while the
// drift label slides out the same way.
function SkipButton({ seconds, forward, onPress }: { seconds: number; forward: boolean; onPress: () => void }) {
  const spin = useRef(new Animated.Value(0)).current;
  const label = useDriftLabel(forward);

  const handlePress = () => {
    spin.stopAnimation();
    spin.setValue(0);
    Animated.sequence([
      Animated.timing(spin, { toValue: 1, duration: 120, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.spring(spin, { toValue: 0, friction: 4, tension: 120, useNativeDriver: true }),
    ]).start();
    label.bump(seconds);
    onPress();
  };

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', forward ? '30deg' : '-30deg'] });
  const scale = spin.interpolate({ inputRange: [0, 1], outputRange: [1, 0.85] });

  return (
    <TouchableOpacity
      style={styles.skipButton}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`${forward ? 'Forward' : 'Back'} ${seconds} seconds`}
    >
      <Animated.View style={{ transform: [{ rotate }, { scale }] }}>
        <SkipIcon size={36} color={WHITE} seconds={seconds} forward={forward} />
      </Animated.View>
      {label.shown > 0 && (
        <Animated.View
          pointerEvents="none"
          style={[styles.skipLabel, forward ? { left: '100%' } : { right: '100%' }, label.style]}
        >
          <Text style={styles.skipLabelText} numberOfLines={1}>
            {label.text}
          </Text>
        </Animated.View>
      )}
    </TouchableOpacity>
  );
}

type SurfaceProps = Omit<VideoPlayerProps, 'onFullscreenChange' | 'allowFullscreen'> & {
  fullscreen: boolean;
  onToggleFullscreen?: () => void;
};

const PlayerSurface = forwardRef<VideoPlayerRef, SurfaceProps>(function PlayerSurface(
  {
    url,
    autoPlay = false,
    startSeconds = 0,
    hideYouTubeBranding = false,
    thumbnail,
    thumbnailOnPause = false,
    showControls = true,
    playbackRates = DEFAULT_RATES,
    seekStepSeconds = 10,
    doubleTapToSeek = true,
    accentColor = '#EF4444',
    fullscreen,
    onToggleFullscreen,
    style,
    renderLoading,
    renderBackButton,
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
  const [rateMenuOpen, setRateMenuOpen] = useState(false);
  const rateScrollRef = useRef<ScrollView>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [trackWidth, setTrackWidth] = useState(0);
  const [dragFraction, setDragFraction] = useState<number | null>(null);
  const [cover, setCover] = useState(INITIAL_COVER);
  const [grabbedPoster, setGrabbedPoster] = useState<string>();
  const [surfaceSize, setSurfaceSize] = useState({ width: 0, height: 0 });
  const tapRef = useRef<{ timer: ReturnType<typeof setTimeout> | null; side: -1 | 0 | 1; lastSeekAt: number }>({
    timer: null,
    side: 0,
    lastSeekAt: 0,
  });
  const backFeedback = useRef<SideFeedbackHandle>(null);
  const forwardFeedback = useRef<SideFeedbackHandle>(null);

  const playing = state === PlayerState.Playing;
  const buffering = state === PlayerState.Buffering;
  const ended = state === PlayerState.Ended;

  useEffect(() => {
    setReady(false);
    setState(PlayerState.Unstarted);
    setCurrent(0);
    setDuration(0);
    setRate(1);
    setRateMenuOpen(false);
    setCover(INITIAL_COVER);
    setGrabbedPoster(undefined);
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

  useEffect(
    () => () => {
      clearHideTimer();
      if (tapRef.current.timer) clearTimeout(tapRef.current.timer);
    },
    [],
  );

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
      setCover(prev => nextCover(prev, next, thumbnailOnPause));
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

  const toggleControls = () => {
    if (!showControls) return;
    if (controlsVisible) {
      clearHideTimer();
      setControlsVisible(false);
    } else {
      revealControls();
    }
  };

  // Double-tap the left/right side to seek; further taps on that side keep seeking while
  // the streak is live. A lone tap (or one in the middle) toggles the controls, after a
  // short wait on the sides to see whether a second tap follows.
  const sideSeek = (side: -1 | 1) => {
    tapRef.current.lastSeekAt = Date.now();
    tapRef.current.side = side;
    seekTo(timeRef.current.current + side * seekStepSeconds);
    (side < 0 ? backFeedback : forwardFeedback).current?.bump(seekStepSeconds);
  };

  const onTap = (event: GestureResponderEvent) => {
    const tap = tapRef.current;
    const { locationX: x, locationY: y } = event.nativeEvent;
    const { width, height } = surfaceSize;
    const inBand = Math.abs(y - height / 2) <= (height * SIDE_ZONE_HEIGHT) / 2;
    const side = !doubleTapToSeek || !showControls || !ready || seekStepSeconds <= 0 || width <= 0 || !inBand
      ? 0
      : x < width * SIDE_ZONE
        ? -1
        : x > width * (1 - SIDE_ZONE)
          ? 1
          : 0;
    const pendingSameSide = tap.timer !== null && tap.side === side;
    if (tap.timer) clearTimeout(tap.timer);
    tap.timer = null;

    if (side === 0) {
      toggleControls();
      return;
    }
    if (pendingSameSide || (tap.side === side && Date.now() - tap.lastSeekAt < DOUBLE_TAP_MS * 2)) {
      sideSeek(side);
      return;
    }
    tap.side = side;
    tap.lastSeekAt = 0;
    tap.timer = setTimeout(() => {
      tap.timer = null;
      toggleControls();
    }, DOUBLE_TAP_MS);
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

  // Controls stay up while the speed menu is open; the hide timer restarts once it closes.
  const openRateMenu = () => {
    clearHideTimer();
    setRateMenuOpen(true);
  };

  const closeRateMenu = () => {
    setRateMenuOpen(false);
    revealControls();
  };

  const pickRate = (next: number) => {
    changeRate(next);
    closeRateMenu();
  };

  const fractionAt = (event: GestureResponderEvent) =>
    trackWidth > 0 ? Math.min(1, Math.max(0, event.nativeEvent.locationX / trackWidth)) : 0;

  const endDrag = () => {
    draggingRef.current = false;
    setDragFraction(null);
  };

  const nativePoster = thumbnail || grabbedPoster;
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
          thumbnailOnPause={thumbnailOnPause}
          thumbnail={thumbnail}
          {...engineProps}
        />
      ) : (
        <NativeVideoEngine
          key={resolved.url}
          ref={engineRef}
          url={resolved.url}
          grabPoster={!thumbnail}
          onPoster={setGrabbedPoster}
          {...engineProps}
        />
      )}

      {/* YouTube draws its thumbnail inside the page, under YouTube's own overlays. */}
      {resolved.kind !== 'youtube' && nativePoster && cover.visible && (
        <Image source={{ uri: nativePoster }} style={styles.thumbnail} resizeMode="cover" accessible={false} />
      )}

      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onTap}
        onLayout={(e: LayoutChangeEvent) => {
          const { width, height } = e.nativeEvent.layout;
          setSurfaceSize({ width, height });
        }}
        accessible={false}
      />

      {(!ready || buffering) && (
        <View style={styles.centerOverlay} pointerEvents="none">
          {renderLoading ? renderLoading() : <ActivityIndicator color={WHITE} size="large" />}
        </View>
      )}

      {showControls && ready && (controlsVisible || rateMenuOpen) && (
        <View style={styles.controls} pointerEvents="box-none">
          {fullscreen && onToggleFullscreen && renderBackButton && (
            <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
              {renderBackButton({ exitFullscreen: onToggleFullscreen })}
            </View>
          )}
          {fullscreen && onToggleFullscreen && !renderBackButton && (
            <TouchableOpacity
              style={styles.backButton}
              onPress={onToggleFullscreen}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Exit fullscreen"
            >
              <BackIcon size={20} color={WHITE} />
            </TouchableOpacity>
          )}
          <View style={styles.centerRow} pointerEvents="box-none">
            {seekStepSeconds > 0 && (
              <SkipButton seconds={seekStepSeconds} forward={false} onPress={() => skip(-seekStepSeconds)} />
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
              <SkipButton seconds={seekStepSeconds} forward onPress={() => skip(seekStepSeconds)} />
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
                onPress={rateMenuOpen ? closeRateMenu : openRateMenu}
                accessibilityRole="button"
                accessibilityLabel="Playback speed"
                accessibilityState={{ expanded: rateMenuOpen }}
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

          {rateMenuOpen && (
            <>
              <Pressable style={StyleSheet.absoluteFill} onPress={closeRateMenu} accessible={false} />
              <View style={[styles.rateMenu, { maxHeight: Math.max(0, surfaceSize.height - 56) }]}>
                <ScrollView
                  bounces={false}
                  onLayout={e => {
                    // Opens scrolled so the current speed is in view.
                    const index = Math.max(0, playbackRates.indexOf(rate));
                    const top = index * RATE_OPTION_HEIGHT - (e.nativeEvent.layout.height - RATE_OPTION_HEIGHT) / 2;
                    rateScrollRef.current?.scrollTo({ y: Math.max(0, top), animated: false });
                  }}
                  ref={rateScrollRef}
                >
                  {playbackRates.map(option => {
                    const selected = option === rate;
                    return (
                      <TouchableOpacity
                        key={option}
                        style={[styles.rateOption, selected && styles.rateOptionSelected]}
                        onPress={() => pickRate(option)}
                        accessibilityRole="button"
                        accessibilityLabel={`${option}x speed`}
                        accessibilityState={{ selected }}
                      >
                        <Text style={[styles.rateOptionText, selected && { color: accentColor }]}>
                          {option === 1 ? 'Normal' : `${option}x`}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            </>
          )}
        </View>
      )}

      {doubleTapToSeek && seekStepSeconds > 0 && (
        <>
          <SideSeekFeedback ref={backFeedback} forward={false} />
          <SideSeekFeedback ref={forwardFeedback} forward />
        </>
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
  thumbnail: { ...StyleSheet.absoluteFill, backgroundColor: BLACK },
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
  skipLabel: { position: 'absolute', top: 0, bottom: 0, justifyContent: 'center' },
  sideFeedback: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: `${SIDE_ZONE * 100}%`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sideFeedbackInner: {
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 40,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  skipLabelText: {
    color: WHITE,
    fontSize: 15,
    fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 4,
  },
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
  rateMenu: {
    position: 'absolute',
    right: 12,
    bottom: 44,
    minWidth: 96,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(20,20,20,0.94)',
    overflow: 'hidden',
  },
  rateOption: { height: RATE_OPTION_HEIGHT, paddingHorizontal: 16, justifyContent: 'center' },
  rateOptionSelected: { backgroundColor: 'rgba(255,255,255,0.12)' },
  rateOptionText: { color: WHITE, fontSize: 14, fontWeight: '600' },
  fullscreenButton: { marginLeft: 10, padding: 3 },
  // Inset past the landscape camera cutout.
  backButton: {
    position: 'absolute',
    top: 12,
    left: 24,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
});
