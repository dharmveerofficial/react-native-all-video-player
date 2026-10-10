import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  DeviceEventEmitter,
  Animated,
  Easing,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import { formatTime } from '../formatTime';
import { resolveSource } from '../source';
import NativeAVPPictureInPicture from '../specs/NativeAVPPictureInPicture';
import { INITIAL_COVER, nextCover } from '../thumbnailCover';
import {
  PlayerState,
  type PlayerError,
  type VideoPlayerOptions,
  type VideoPlayerProps,
  type VideoPlayerRef,
} from '../types';
import { useFullscreenOrientation } from '../useFullscreenOrientation';
import { NativeVideoEngine, YouTubeEngine, type EngineHandle, type EngineProps } from './engines';
import { BackIcon, FullscreenIcon, PauseIcon, PlayIcon, ReplayIcon, SettingsIcon, TrackIcon } from './icons';

const DEFAULT_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const CONTROLS_HIDE_DELAY_MS = 3000;
const RATE_OPTION_HEIGHT = 36;
const DOUBLE_TAP_MS = 280;
// Double-tap seeks only within the middle band of the height (taps above or below just
// toggle controls).
const SIDE_ZONE_HEIGHT = 0.4;
// Center row geometry, shared with the double-tap areas and their label.
const PLAY_SIZE = 64;
const PLAY_GAP = 28;
const TRACK_ICON = 20;
const TRACK_PADDING = 10;
const TRACK_GAP = 8;
// Distance from the center to where each double-tap area begins: just past the previous/next
// buttons in a playlist, otherwise just past the play/pause button.
const TRACK_ZONE_EDGE = PLAY_SIZE / 2 + PLAY_GAP + TRACK_GAP + TRACK_PADDING * 2 + TRACK_ICON + TRACK_GAP;
const PLAY_ZONE_EDGE = PLAY_SIZE / 2 + 8;
// How far the double-tap label drifts outward; shortened when the player is too narrow.
const DRIFT_DISTANCE = 84;
const EDGE_MARGIN = 8;
const WHITE = '#FFFFFF';
const BLACK = '#000000';

// A "+10" / "-10" label that drifts out toward its direction and fades. Bumping it again
// before it fades adds to the total, so quick repeat double-taps read "+20", "+30"...
function useDriftLabel(forward: boolean, distance = DRIFT_DISTANCE) {
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
    transform: [{ translateX: drift.interpolate({ inputRange: [0, 1], outputRange: [0, forward ? distance : -distance] }) }],
  };
  const text = `${forward ? '+' : '-'}${shown}`;
  return { shown, bump, style, text };
}

type SideFeedbackHandle = { bump: (seconds: number) => void };

// Double-tap feedback over the left or right side of the video, shown even with controls hidden.
// It starts at the inner edge of its double-tap area (edge: distance from the center) and
// drifts outward, never past the player's edge (halfWidth: half the player's width).
const SideSeekFeedback = forwardRef<SideFeedbackHandle, { forward: boolean; edge: number; halfWidth: number }>(
  function SideSeekFeedback({ forward, edge, halfWidth }, ref) {
    const [labelWidth, setLabelWidth] = useState(0);
    const room = halfWidth - edge - labelWidth - EDGE_MARGIN;
    const label = useDriftLabel(forward, Math.max(0, Math.min(DRIFT_DISTANCE, room)));
    useImperativeHandle(ref, () => ({ bump: label.bump }), [label.bump]);
    if (label.shown === 0) return null;
    return (
      <View
        pointerEvents="none"
        style={[
          styles.sideFeedback,
          forward ? { left: '50%', marginLeft: edge, alignItems: 'flex-start' } : { right: '50%', marginRight: edge, alignItems: 'flex-end' },
        ]}
      >
        <Animated.View
          style={[styles.sideFeedbackInner, label.style]}
          onLayout={e => setLabelWidth(e.nativeEvent.layout.width)}
        >
          <Text style={styles.skipLabelText}>{label.text}</Text>
        </Animated.View>
      </View>
    );
  },
);

type SurfaceProps = Omit<
  VideoPlayerOptions,
  'onFullscreenChange' | 'allowFullscreen' | 'onVideoChange' | 'playlistStartIndex'
> & {
  url: string;
  fullscreen: boolean;
  onToggleFullscreen?: () => void;
  autoPlayNext?: boolean;
  /** Shows the "Autoplay next" switch (playlists only). */
  onAutoPlayNextChange?: (enabled: boolean) => void;
  /** Playlists only: previous/next video buttons; a missing handler disables that button. */
  playlistNav?: { onPrevious?: () => void; onNext?: () => void };
  /** Android: enters picture in picture for the whole player (it's activity-wide there). */
  onEnterPictureInPicture?: () => void;
  /** In the picture-in-picture window: no loading spinner (too small to help, and its redraws lag there). */
  inPictureInPicture?: boolean;
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
    autoPlayNext = false,
    onAutoPlayNextChange,
    playlistNav,
    allowPictureInPicture = true,
    onPictureInPictureChange,
    onEnterPictureInPicture,
    inPictureInPicture = false,
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
  // Settings menu: closed, its main list, or the playback speed list.
  const [settingsView, setSettingsView] = useState<'main' | 'speed' | null>(null);
  const rateScrollRef = useRef<ScrollView>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [trackWidth, setTrackWidth] = useState(0);
  const [dragFraction, setDragFraction] = useState<number | null>(null);
  const [cover, setCover] = useState(INITIAL_COVER);
  const [grabbedPoster, setGrabbedPoster] = useState<string>();
  // iOS: the video view says when picture in picture can start.
  const [pipPossible, setPipPossible] = useState(false);
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
    setSettingsView(null);
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
      setFullscreen: () => { },
      enterPictureInPicture: () => pipActionRef.current?.(),
    }),
    [seekTo, changeRate],
  );

  // ref.enterPictureInPicture(): Android hands it to the outer player; iOS starts it on this video view.
  const pipAction =
    onEnterPictureInPicture ??
    (allowPictureInPicture && pipPossible ? () => engineRef.current?.startPictureInPicture() : undefined);
  const pipActionRef = useRef(pipAction);
  pipActionRef.current = pipAction;

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

  const zoneEdge = playlistNav ? TRACK_ZONE_EDGE : PLAY_ZONE_EDGE;

  const onTap = (event: GestureResponderEvent) => {
    const tap = tapRef.current;
    const { locationX: x, locationY: y } = event.nativeEvent;
    const { width, height } = surfaceSize;
    const inBand = Math.abs(y - height / 2) <= (height * SIDE_ZONE_HEIGHT) / 2;
    const side = !doubleTapToSeek || !showControls || !ready || seekStepSeconds <= 0 || width <= 0 || !inBand
      ? 0
      : x < width / 2 - zoneEdge
        ? -1
        : x > width / 2 + zoneEdge
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

  // Controls stay up while the settings menu is open; the hide timer restarts once it closes.
  const openSettings = () => {
    clearHideTimer();
    setSettingsView('main');
  };

  const closeSettings = () => {
    setSettingsView(null);
    revealControls();
  };

  const pickRate = (next: number) => {
    changeRate(next);
    closeSettings();
  };

  const rateLabel = (value: number) => (value === 1 ? 'Normal' : `${value}x`);

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
          autoPlay={autoPlay}
          {...engineProps}
        />
      ) : (
        <NativeVideoEngine
          key={resolved.url}
          ref={engineRef}
          url={resolved.url}
          grabPoster={!thumbnail}
          onPoster={setGrabbedPoster}
          pictureInPicture={Platform.OS === 'ios' && allowPictureInPicture}
          autoEnterPictureInPicture={Platform.OS === 'ios' && allowPictureInPicture}
          onPictureInPicturePossible={setPipPossible}
          onPictureInPicture={active => onPictureInPictureChange?.(active)}
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

      {(!ready || buffering) && !inPictureInPicture && (
        <View style={styles.centerOverlay} pointerEvents="none">
          {renderLoading ? renderLoading() : <ActivityIndicator color={WHITE} size="large" />}
        </View>
      )}

      {showControls && ready && (controlsVisible || settingsView !== null) && (
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
            {playlistNav && (
              <TouchableOpacity
                style={[styles.trackButton, !playlistNav.onPrevious && styles.trackButtonDisabled]}
                onPress={playlistNav.onPrevious}
                disabled={!playlistNav.onPrevious}
                accessibilityRole="button"
                accessibilityLabel="Previous video"
                accessibilityState={{ disabled: !playlistNav.onPrevious }}
              >
                <TrackIcon size={TRACK_ICON} color={WHITE} next={false} />
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
            {playlistNav && (
              <TouchableOpacity
                style={[styles.trackButton, !playlistNav.onNext && styles.trackButtonDisabled]}
                onPress={playlistNav.onNext}
                disabled={!playlistNav.onNext}
                accessibilityRole="button"
                accessibilityLabel="Next video"
                accessibilityState={{ disabled: !playlistNav.onNext }}
              >
                <TrackIcon size={TRACK_ICON} color={WHITE} next />
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
            {(playbackRates.length > 0 || onAutoPlayNextChange) && (
              <TouchableOpacity
                style={styles.settingsButton}
                onPress={settingsView ? closeSettings : openSettings}
                accessibilityRole="button"
                accessibilityLabel="Settings"
                accessibilityState={{ expanded: settingsView !== null }}
              >
                <SettingsIcon size={20} color={WHITE} />
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
                <FullscreenIcon size={20} color={WHITE} exit={fullscreen} />
              </TouchableOpacity>
            )}
          </View>

          {settingsView && (
            <>
              <Pressable style={StyleSheet.absoluteFill} onPress={closeSettings} accessible={false} />
              <View style={[styles.settingsMenu, { maxHeight: Math.max(0, surfaceSize.height - 56) }]}>
                {settingsView === 'main' ? (
                  <>
                    {playbackRates.length > 0 && (
                      <TouchableOpacity
                        style={styles.settingsRow}
                        onPress={() => setSettingsView('speed')}
                        accessibilityRole="button"
                        accessibilityLabel={`Playback speed, ${rateLabel(rate)}`}
                      >
                        <Text style={styles.settingsRowText}>Playback speed</Text>
                        <Text style={styles.settingsRowValue}>{rateLabel(rate)}  ›</Text>
                      </TouchableOpacity>
                    )}
                    {onAutoPlayNextChange && (
                      <TouchableOpacity
                        style={styles.settingsRow}
                        onPress={() => onAutoPlayNextChange(!autoPlayNext)}
                        accessibilityRole="switch"
                        accessibilityLabel="Autoplay next"
                        accessibilityState={{ checked: autoPlayNext }}
                      >
                        <Text style={styles.settingsRowText}>Autoplay next</Text>
                        <Switch
                          value={autoPlayNext}
                          onValueChange={onAutoPlayNextChange}
                          trackColor={{ false: 'rgba(255,255,255,0.3)', true: accentColor }}
                          thumbColor={WHITE}
                          style={styles.settingsSwitch}
                        />
                      </TouchableOpacity>
                    )}
                  </>
                ) : (
                  <>
                    <TouchableOpacity
                      style={[styles.settingsRow, styles.settingsBackRow]}
                      onPress={() => setSettingsView('main')}
                      accessibilityRole="button"
                      accessibilityLabel="Back to settings"
                    >
                      <View style={styles.settingsBackLabel}>
                        <Text style={styles.settingsBackArrow}>‹</Text>
                        <Text style={styles.settingsRowText}>Playback speed</Text>
                      </View>
                    </TouchableOpacity>
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
                              {rateLabel(option)}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  </>
                )}
              </View>
            </>
          )}
        </View>
      )}

      {doubleTapToSeek && seekStepSeconds > 0 && (
        <>
          <SideSeekFeedback ref={backFeedback} forward={false} edge={zoneEdge} halfWidth={surfaceSize.width / 2} />
          <SideSeekFeedback ref={forwardFeedback} forward edge={zoneEdge} halfWidth={surfaceSize.width / 2} />
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
  {
    url,
    autoPlay = false,
    onFullscreenChange,
    allowFullscreen = true,
    style,
    onStateChange,
    onProgress,
    onEnd,
    onVideoChange,
    playlist,
    playlistStartIndex = 0,
    autoPlayNext = true,
    onAutoPlayNextChange,
    allowPictureInPicture = true,
    onPictureInPictureChange,
    ...surfaceProps
  },
  ref,
) {
  const [fullscreen, setFullscreenState] = useState(false);
  const windowSize = useWindowDimensions();
  // Android picture in picture shrinks the whole app, so the player shows full-size in the
  // Modal while it lasts (the same one fullscreen uses), without controls.
  const [pip, setPip] = useState(false);
  const modalOpen = fullscreen || pip;
  const androidPip = useMemo(
    () => Platform.OS === 'android' && allowPictureInPicture && !!NativeAVPPictureInPicture?.isSupported(),
    [allowPictureInPicture],
  );
  const [playing, setPlaying] = useState(false);
  // Playlist position and the "Autoplay next" switch, shared by the inline and fullscreen players.
  const urls = useMemo(() => (playlist?.length ? playlist : [url ?? '']), [playlist, url]);
  const playlistKey = urls.join('\n');
  const firstIndex = Math.min(Math.max(0, Math.floor(playlistStartIndex) || 0), urls.length - 1);
  const [index, setIndex] = useState(firstIndex);
  const [autoNext, setAutoNext] = useState(autoPlayNext);
  useEffect(() => setAutoNext(autoPlayNext), [autoPlayNext]);
  // After moving on by itself, the next video starts playing without a tap.
  const [advanced, setAdvanced] = useState(false);
  useEffect(() => {
    setIndex(firstIndex);
    setAdvanced(false);
  }, [playlistKey, firstIndex]);
  const current = urls[Math.min(index, urls.length - 1)] ?? '';
  const hasNext = index < urls.length - 1;
  const inlineRef = useRef<VideoPlayerRef>(null);
  const modalRef = useRef<VideoPlayerRef>(null);
  const inlineState = useRef<PlayerState>(PlayerState.Unstarted);
  const modalState = useRef<PlayerState>(PlayerState.Unstarted);
  const [resume, setResume] = useState({ seconds: 0, playing: false });

  // Switches to another playlist video and starts it playing.
  const goTo = (next: number) => {
    setIndex(next);
    setAdvanced(true);
    // A fullscreen player switching videos starts the new one from the top.
    setResume({ seconds: 0, playing: true });
    onVideoChange?.(next, urls[next]);
  };

  const handleEnd = () => {
    onEnd?.();
    if (autoNext && hasNext) goTo(index + 1);
  };
  const isPlaylist = urls.length > 1;
  const autoNextProps = {
    autoPlayNext: autoNext,
    onAutoPlayNextChange: isPlaylist
      ? (enabled: boolean) => {
        setAutoNext(enabled);
        onAutoPlayNextChange?.(enabled);
      }
      : undefined,
    playlistNav: isPlaylist
      ? {
        onPrevious: index > 0 ? () => goTo(index - 1) : undefined,
        onNext: hasNext ? () => goTo(index + 1) : undefined,
      }
      : undefined,
  };

  useFullscreenOrientation(fullscreen && !pip);

  // Android: the player moves into the Modal for picture in picture, from the inline player
  // (handing over its position) or as-is from fullscreen; leaving hands it back.
  const pipFromInline = useRef(false);
  const startPip = () => {
    if (pip) return;
    pipFromInline.current = !fullscreen;
    if (!fullscreen) {
      setResume({
        seconds: inlineRef.current?.getCurrentTime() ?? 0,
        playing: inlineState.current === PlayerState.Playing,
      });
      modalState.current = PlayerState.Unstarted;
      inlineRef.current?.pause();
    }
    setPip(true);
  };
  const stopPip = (dismissed: boolean) => {
    if (!pip) return;
    setPip(false);
    if (pipFromInline.current) {
      const modal = modalRef.current;
      if (modal) inlineRef.current?.seekTo(modal.getCurrentTime());
      if (!dismissed && modalState.current === PlayerState.Playing) inlineRef.current?.play();
    } else if (dismissed) {
      modalRef.current?.pause();
    }
  };
  const pipHandlers = useRef({ startPip, stopPip, onPictureInPictureChange });
  pipHandlers.current = { startPip, stopPip, onPictureInPictureChange };

  useEffect(() => {
    if (!androidPip) return;
    const subscription = DeviceEventEmitter.addListener(
      'AVPPictureInPictureChange',
      (event: { active: boolean; dismissed: boolean }) => {
        if (event.active) pipHandlers.current.startPip();
        else pipHandlers.current.stopPip(event.dismissed);
        pipHandlers.current.onPictureInPictureChange?.(event.active);
      },
    );
    return () => subscription.remove();
  }, [androidPip]);

  // Enter by itself when the user minimizes the app while a video plays.
  useEffect(() => {
    if (androidPip) NativeAVPPictureInPicture?.setAutoEnter(playing, 16, 9);
  }, [androidPip, playing]);
  useEffect(() => {
    if (!androidPip) return;
    return () => NativeAVPPictureInPicture?.setAutoEnter(false, 16, 9);
  }, [androidPip]);

  // The picture-in-picture window's buttons (Android draws them; its window isn't touchable).
  useEffect(() => {
    // Optional call: an app still on an older native build doesn't have it yet.
    if (androidPip) NativeAVPPictureInPicture?.setActions?.(playing, isPlaylist, index > 0, hasNext);
  }, [androidPip, playing, isPlaylist, index, hasNext]);
  const pipActionHandler = useRef<(action: string) => void>(() => {});
  pipActionHandler.current = action => {
    const player = (modalOpen ? modalRef : inlineRef).current;
    const step = surfaceProps.seekStepSeconds ?? 10;
    if (action === 'play') player?.play();
    else if (action === 'pause') player?.pause();
    else if (action === 'back') player?.seekTo((player?.getCurrentTime() ?? 0) - step);
    else if (action === 'forward') player?.seekTo((player?.getCurrentTime() ?? 0) + step);
    else if (action === 'previous' && index > 0) goTo(index - 1);
    else if (action === 'next' && hasNext) goTo(index + 1);
  };
  useEffect(() => {
    if (!androidPip) return;
    const subscription = DeviceEventEmitter.addListener('AVPPictureInPictureAction', (event: { action: string }) =>
      pipActionHandler.current(event.action),
    );
    return () => subscription.remove();
  }, [androidPip]);

  const enterAndroidPip = () => {
    startPip();
    if (!NativeAVPPictureInPicture?.enter(16, 9)) stopPip(false);
  };
  const enterAndroidPipRef = useRef(enterAndroidPip);
  enterAndroidPipRef.current = enterAndroidPip;

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
      const active = () => (modalOpen ? modalRef : inlineRef).current;
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
        enterPictureInPicture: () => (androidPip ? enterAndroidPipRef.current() : active()?.enterPictureInPicture()),
      };
    },
    [modalOpen, setFullscreen, androidPip],
  );

  const toggleFullscreen = allowFullscreen ? () => setFullscreen(!fullscreen) : undefined;
  const pipProps = {
    allowPictureInPicture,
    onPictureInPictureChange,
    onEnterPictureInPicture: androidPip ? enterAndroidPip : undefined,
  };

  return (
    <>
      {modalOpen && <StatusBar hidden animated />}
      <PlayerSurface
        {...surfaceProps}
        {...autoNextProps}
        {...pipProps}
        url={current}
        // Stays quiet under the fullscreen player; that one plays the next video.
        autoPlay={!modalOpen && (autoPlay || advanced)}
        ref={inlineRef}
        style={style}
        fullscreen={false}
        onToggleFullscreen={toggleFullscreen}
        onStateChange={next => {
          inlineState.current = next;
          if (modalOpen) return;
          setPlaying(next === PlayerState.Playing);
          onStateChange?.(next);
        }}
        onProgress={event => !modalOpen && onProgress?.(event)}
        onEnd={() => !modalOpen && handleEnd()}
      />
      {modalOpen && (
        <Modal
          visible
          animationType="fade"
          statusBarTranslucent
          supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
          onRequestClose={() => setFullscreen(false)}
        >
          <PlayerSurface
            {...surfaceProps}
            {...autoNextProps}
            {...pipProps}
            url={current}
            ref={modalRef}
            showControls={pip ? false : surfaceProps.showControls}
            inPictureInPicture={pip}
            // The Modal stays screen-sized in picture in picture; the window shows its top-left.
            style={pip ? { position: 'absolute', left: 0, top: 0, width: windowSize.width, height: windowSize.height } : StyleSheet.absoluteFill}
            startSeconds={resume.seconds}
            autoPlay={resume.playing}
            fullscreen
            onToggleFullscreen={toggleFullscreen}
            onReady={undefined}
            onStateChange={next => {
              modalState.current = next;
              setPlaying(next === PlayerState.Playing);
              onStateChange?.(next);
            }}
            onProgress={onProgress}
            onEnd={handleEnd}
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
    width: PLAY_SIZE,
    height: PLAY_SIZE,
    borderRadius: PLAY_SIZE / 2,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: PLAY_GAP,
  },
  trackButton: { padding: TRACK_PADDING, marginHorizontal: TRACK_GAP },
  trackButtonDisabled: { opacity: 0.35 },
  sideFeedback: {
    position: 'absolute',
    top: 0,
    bottom: 0,
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
  settingsButton: { marginLeft: 8, padding: 3 },
  settingsMenu: {
    position: 'absolute',
    right: 12,
    bottom: 44,
    minWidth: 180,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(20,20,20,0.94)',
    overflow: 'hidden',
  },
  settingsRow: {
    height: RATE_OPTION_HEIGHT + 4,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  settingsBackRow: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.25)' },
  settingsBackLabel: { flexDirection: 'row', alignItems: 'center' },
  settingsBackArrow: { color: WHITE, fontSize: 26, lineHeight: 30, fontWeight: '600', marginRight: 10, marginTop: -3 },
  settingsRowText: { color: WHITE, fontSize: 14, fontWeight: '600' },
  settingsSwitch: { marginLeft: 16 },
  settingsRowValue: { color: 'rgba(255,255,255,0.7)', fontSize: 14, marginLeft: 16 },
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
