import {
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
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
import { PlayerSettingsProvider, usePlayerSettings } from '../settingsContext';
import { InsideMiniPlayer, miniPlayer, type MiniRect } from '../miniPlayerStore';
import { mediaSession, type MediaControls } from '../mediaSession';
import { useScreenNavigation } from '../screenNavigation';
import { PlaylistPanel } from './PlaylistPanel';
import NativeAVPPictureInPicture from '../specs/NativeAVPPictureInPicture';
import { INITIAL_COVER, nextCover } from '../thumbnailCover';
import {
  PlayerState,
  type PlayerError,
  type PlaylistItem,
  type VideoPlayerOptions,
  type VideoPlayerProps,
  type VideoPlayerRef,
} from '../types';
import { useFullscreenOrientation } from '../useFullscreenOrientation';
import { NativeVideoEngine, YouTubeEngine, type EngineHandle, type EngineProps } from './engines';
import { BackIcon, FullscreenIcon, PauseIcon, PlayIcon, ReplayIcon, SettingsIcon, TrackIcon } from './icons';

const DEFAULT_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const CONTROLS_HIDE_DELAY_MS = 3000;
const DEFAULT_ACCENT = '#EF4444';
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

const INVALID_URL_MESSAGE = 'Not a supported video link';

// What the default error overlay says. Raw messages from the native players are technical, so
// only the url problems (which this file words itself) are shown as-is.
function errorMessage(error: PlayerError, hasUrl: boolean): string {
  if (!hasUrl) return 'No video to play.';
  switch (error.code) {
    case 2:
      return 'This video link isn\'t valid.';
    // YouTube reports missing, private and embed-blocked videos with these codes interchangeably.
    case 100:
    case 101:
    case 150:
    case 152:
    case 153:
      return 'This video isn\'t available. It may be private, removed, or not allowed to play here.';
  }
  if (error.message === INVALID_URL_MESSAGE) return 'This link isn\'t a supported video link.';
  return 'This video couldn\'t be played. Check your connection and try again.';
}

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
  /** The viewer's captions choice, kept by the outer player across videos and fullscreen. */
  captionsOn?: boolean;
  onCaptionsChange?: (on: boolean) => void;
  /** Android: enters picture in picture for the whole player (it's activity-wide there). */
  onEnterPictureInPicture?: () => void;
  /** In the picture-in-picture window: no loading spinner (too small to help, and its redraws lag there). */
  inPictureInPicture?: boolean;
  /** Swiping down on the video calls this (into the mini player, or out of fullscreen). */
  onSwipeDown?: () => void;
  /** Swiping up on the video calls this (into fullscreen). */
  onSwipeUp?: () => void;
};

// With the playlist listed below, the player takes the space it's given: the video (sized by
// `style`) on top, the list filling the rest. Without it, nothing wraps the video.
function WithPanel({ panel, children }: { panel: ReactNode; children: ReactNode }) {
  if (!panel) return <>{children}</>;
  return (
    <View style={styles.withPanel}>
      {children}
      {panel}
    </View>
  );
}

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
    accentColor = DEFAULT_ACCENT,
    fullscreen,
    onToggleFullscreen,
    style,
    renderLoading,
    renderBackButton,
    renderError,
    onReady,
    onStateChange,
    onProgress,
    onEnd,
    onError,
    autoPlayNext = false,
    onAutoPlayNextChange,
    playlistNav,
    captionsOn = true,
    onCaptionsChange,
    allowPictureInPicture = true,
    onPictureInPictureChange,
    onEnterPictureInPicture,
    inPictureInPicture = false,
    onSwipeDown,
    onSwipeUp,
  },
  ref,
) {
  const resolved = useMemo(() => resolveSource(url ?? ''), [url]);
  // Swipe down / up: the video follows the finger, then hands off once dragged far enough. Read
  // from raw touch events rather than by claiming the gesture, since native gesture systems above
  // (e.g. react-native-gesture-handler's root view) can cancel a claimed touch mid-swipe. Only
  // clearly vertical drags count (the seek bar drags sideways), and not while the settings menu
  // (which scrolls) is open.
  const swipeDrag = useRef(new Animated.Value(0)).current;
  const swipe = useRef({ onSwipeDown, onSwipeUp, enabled: false });
  const swipeTouch = useRef<{ x: number; y: number; t: number; dx: number; dy: number } | null>(null);
  const onSwipeTouchStart = (e: GestureResponderEvent) => {
    if (!swipe.current.enabled || e.nativeEvent.touches.length > 1) {
      swipeTouch.current = null;
      return;
    }
    swipeTouch.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, t: Date.now(), dx: 0, dy: 0 };
  };
  const onSwipeTouchMove = (e: GestureResponderEvent) => {
    const touch = swipeTouch.current;
    if (!touch) return;
    touch.dx = e.nativeEvent.pageX - touch.x;
    touch.dy = e.nativeEvent.pageY - touch.y;
    if (Math.abs(touch.dy) <= 14 || Math.abs(touch.dy) <= Math.abs(touch.dx) * 1.5) return;
    if (touch.dy > 0 && swipe.current.onSwipeDown) swipeDrag.setValue(touch.dy * 0.6);
    else if (touch.dy < 0 && swipe.current.onSwipeUp) swipeDrag.setValue(touch.dy * 0.3);
  };
  const onSwipeTouchEnd = () => {
    const touch = swipeTouch.current;
    swipeTouch.current = null;
    Animated.spring(swipeDrag, { toValue: 0, useNativeDriver: false }).start();
    if (!touch || Math.abs(touch.dy) <= Math.abs(touch.dx) * 1.5) return;
    const distance = Math.abs(touch.dy);
    const speed = distance / Math.max(1, Date.now() - touch.t);
    if (distance <= 70 && !(distance > 30 && speed > 0.8)) return;
    if (touch.dy > 0) swipe.current.onSwipeDown?.();
    else swipe.current.onSwipeUp?.();
  };
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
  // Whether the current video has captions; whether they show is the captionsOn prop.
  const [captionsAvailable, setCaptionsAvailable] = useState(false);
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

  // The clock moving means the video is playing, whatever the last state event said: YouTube in
  // particular can leave a stale Buffering (or no Ready) behind while the video plays on.
  const [advancing, setAdvancing] = useState(false);
  const lastTickRef = useRef<number | null>(null);

  // A moving clock also counts as playing, and not ended: state events can be late or missed
  // (YouTube especially), which would leave the play button showing the wrong icon.
  const playing = state === PlayerState.Playing || advancing;
  const buffering = state === PlayerState.Buffering;
  const ended = state === PlayerState.Ended && !advancing;
  const loading = (!ready || buffering) && !advancing;

  // Playback failed: shown over the player until Retry (or a new url) loads it again.
  const [error, setError] = useState<PlayerError | null>(null);
  // Bumped by Retry to remount the engine for a fresh load.
  const [attempt, setAttempt] = useState(0);

  const resetPlayback = () => {
    setReady(false);
    setAdvancing(false);
    lastTickRef.current = null;
    setState(PlayerState.Unstarted);
    setCurrent(0);
    setDuration(0);
    setRate(1);
    setSettingsView(null);
    setCover(INITIAL_COVER);
    setGrabbedPoster(undefined);
    setCaptionsAvailable(false);
    timeRef.current = { current: 0, duration: 0 };
  };

  useEffect(() => {
    resetPlayback();
    setAttempt(0);
    if (resolved) {
      setError(null);
    } else {
      const invalid = { message: url ? INVALID_URL_MESSAGE : 'No video URL' };
      setError(invalid);
      onError?.(invalid);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved, url]);

  const retry = () => {
    resetPlayback();
    setError(null);
    setAttempt(n => n + 1);
  };

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
      // Ticks come about every 500 ms; up to 1.5 s of progress covers 2x speed, while a seek
      // jumps further (or backwards) and doesn't count.
      const last = lastTickRef.current;
      lastTickRef.current = time;
      const delta = last === null ? 0 : time - last;
      setAdvancing(delta > 0.05 && delta < 1.5);
      // The ready event can be lost when a video loads very fast (it fires before the native
      // view is listening); time moving proves the player is ready, so the controls can show.
      if (delta > 0.05) setReady(true);
      const total = reported || timeRef.current.duration;
      timeRef.current = { current: time, duration: total };
      if (!draggingRef.current) setCurrent(time);
      if (total) setDuration(total);
      onProgress?.({ currentTime: time, duration: total });
    },
    onError: (failure: PlayerError) => {
      setError(failure);
      onError?.(failure);
    },
    onCaptions: (available, on) => {
      setCaptionsAvailable(available);
      // Each new video (or the fullscreen player) starts from its own default; apply the choice.
      if (available && on !== captionsOn) engineRef.current?.setCaptions(captionsOn);
    },
  };

  // Takes the new value (the Switch passes it), so the switch and its row both firing can't cancel out.
  const toggleCaptions = (on: boolean) => {
    onCaptionsChange?.(on);
    engineRef.current?.setCaptions(on);
  };

  // What's on screen, read live: the controls only draw once the video is ready (so right after
  // a video switch controlsVisible can be true with nothing showing), and a side tap toggles
  // ~280 ms later, by when they may have auto-hidden. Either way a tap must show them.
  const controlsVisibleRef = useRef(false);
  controlsVisibleRef.current = showControls && ready && (controlsVisible || settingsView !== null);
  const toggleControls = () => {
    if (!showControls) return;
    if (controlsVisibleRef.current) {
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

  // Headphone / earphone / Bluetooth buttons (and the iOS lock screen) control this player while
  // it's the one playing: the media session follows the last player that started.
  const [mediaId] = useState(() => mediaSession.newId());
  const buildMediaControls = (): MediaControls => ({
    play: () => engineRef.current?.play(),
    pause: () => engineRef.current?.pause(),
    seekTo,
    next: playlistNav?.onNext,
    previous: playlistNav?.onPrevious,
  });
  const mediaControls = useRef(buildMediaControls);
  mediaControls.current = buildMediaControls;
  const hasNextTrack = !!playlistNav?.onNext;
  const hasPreviousTrack = !!playlistNav?.onPrevious;
  useEffect(() => {
    if (!ready) return;
    mediaSession.update(mediaId, { playing, position: timeRef.current.current, duration }, () => mediaControls.current());
  }, [mediaId, ready, playing, duration, hasNextTrack, hasPreviousTrack]);
  useEffect(() => () => mediaSession.release(mediaId), [mediaId]);

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

  // A missing or unrecognised url can't be fixed by reloading, so it gets no Retry.
  const errorOverlay = (failure: PlayerError) => (
    <View style={StyleSheet.absoluteFill}>
      {renderError ? (
        renderError({ error: failure, retry: resolved ? retry : undefined })
      ) : (
        <View style={styles.errorOverlay}>
          <Text style={styles.errorText}>{errorMessage(failure, !!url)}</Text>
          {resolved && (
            <TouchableOpacity
              style={[styles.errorButton, { backgroundColor: accentColor }]}
              onPress={retry}
              accessibilityRole="button"
            >
              <Text style={styles.errorButtonText}>Retry</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
      {fullscreen && onToggleFullscreen && (
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
    </View>
  );

  if (!resolved) {
    return (
      <View style={[styles.container, style]}>
        {errorOverlay({ message: url ? INVALID_URL_MESSAGE : 'No video URL' })}
      </View>
    );
  }

  const swipes = !!onSwipeDown || !!onSwipeUp;
  swipe.current = { onSwipeDown, onSwipeUp, enabled: swipes && settingsView === null };

  return (
    <Animated.View
      style={[
        styles.container,
        style,
        // Always present (it rests at 0): dropping an animated transform while it runs crashes Fabric.
        {
          transform: [{ translateY: swipeDrag }],
          opacity: swipeDrag.interpolate({ inputRange: [0, 160], outputRange: [1, 0.6], extrapolate: 'clamp' }),
        },
      ]}
      onTouchStart={swipes ? onSwipeTouchStart : undefined}
      onTouchMove={swipes ? onSwipeTouchMove : undefined}
      onTouchEnd={swipes ? onSwipeTouchEnd : undefined}
      onTouchCancel={swipes ? onSwipeTouchEnd : undefined}
    >
      {resolved.kind === 'youtube' ? (
        <YouTubeEngine
          key={`${resolved.videoId}:${attempt}`}
          ref={engineRef}
          videoId={resolved.videoId}
          hideBranding={hideYouTubeBranding}
          thumbnailOnPause={thumbnailOnPause}
          thumbnail={thumbnail}
          autoPlay={autoPlay}
          captions={captionsOn}
          {...engineProps}
        />
      ) : (
        <NativeVideoEngine
          key={`${resolved.url}:${attempt}`}
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

      {loading && !error && !inPictureInPicture && (
        <View style={styles.centerOverlay} pointerEvents="none">
          {renderLoading ? renderLoading() : <ActivityIndicator color={WHITE} size="large" />}
        </View>
      )}

      {showControls && ready && !error && (controlsVisible || settingsView !== null) && (
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
          {/* The spinner takes the center while loading, so the center buttons step aside. */}
          {!loading && (
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
          )}

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
            {(playbackRates.length > 0 || onAutoPlayNextChange || captionsAvailable) && (
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
                    {captionsAvailable && (
                      <TouchableOpacity
                        style={styles.settingsRow}
                        onPress={() => toggleCaptions(!captionsOn)}
                        accessibilityRole="switch"
                        accessibilityLabel="Captions"
                        accessibilityState={{ checked: captionsOn }}
                      >
                        <Text style={styles.settingsRowText}>Captions</Text>
                        <Switch
                          value={captionsOn}
                          onValueChange={toggleCaptions}
                          trackColor={{ false: 'rgba(255,255,255,0.3)', true: accentColor }}
                          thumbColor={WHITE}
                          style={styles.settingsSwitch}
                        />
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

      {error && !inPictureInPicture && errorOverlay(error)}

      {doubleTapToSeek && seekStepSeconds > 0 && (
        <>
          <SideSeekFeedback ref={backFeedback} forward={false} edge={zoneEdge} halfWidth={surfaceSize.width / 2} />
          <SideSeekFeedback ref={forwardFeedback} forward edge={zoneEdge} halfWidth={surfaceSize.width / 2} />
        </>
      )}
    </Animated.View>
  );
});

/**
 * Fullscreen opens a second player in a Modal that resumes where the inline one
 * was; the inline player waits paused underneath and takes over again on exit.
 */
export const VideoPlayer = forwardRef<VideoPlayerRef, VideoPlayerProps>(function VideoPlayer(props, ref) {
  const {
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
    allowPictureInPicture = true,
    onPictureInPictureChange,
    ...surfaceProps
  } = props;
  // On a React Navigation screen: minimizing closes it, and the mini player reopens it.
  const screen = useScreenNavigation();
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
  const urls = useMemo(
    () => (playlist?.length ? playlist.map(item => (typeof item === 'string' ? item : item.url)) : [url ?? '']),
    [playlist, url],
  );
  // Items with titles are also listed under the player.
  const items = useMemo(
    () => (playlist?.length && typeof playlist[0] !== 'string' ? (playlist as PlaylistItem[]) : null),
    [playlist],
  );
  const playlistKey = urls.join('\n');
  const firstIndex = Math.min(Math.max(0, Math.floor(playlistStartIndex) || 0), urls.length - 1);
  // A player shown with the video the mini player has while its own screen is gone (e.g. that
  // screen reopened from the mini player) takes the video over from it, from where it got to.
  const insideMini = useContext(InsideMiniPlayer);
  const miniAvailable = useMemo(() => !insideMini && miniPlayer.supported(), [insideMini]);
  const [adopted] = useState(() => {
    if (!miniAvailable || !miniPlayer.canAdopt(props, firstIndex)) return null;
    const id = miniPlayer.getSession()?.id;
    return id === undefined ? null : { id, live: miniPlayer.getLiveState() };
  });
  const adoptId = adopted?.id ?? null;
  const [index, setIndex] = useState(() => Math.min(adopted?.live?.index ?? firstIndex, urls.length - 1));
  // The settings menu's "Captions" and "Autoplay next" choices, kept in the internal settings
  // context for the app session: shared by every video, fullscreen and later players. On by default.
  const [{ captionsOn, autoPlayNext: autoNext }, setSettings] = usePlayerSettings();
  const setCaptionsOn = (on: boolean) => setSettings({ captionsOn: on });
  const setAutoNext = (on: boolean) => setSettings({ autoPlayNext: on });
  // After moving on by itself, the next video starts playing without a tap.
  const [advanced, setAdvanced] = useState(false);
  const firstRun = useRef(true);
  useEffect(() => {
    // On mount the index is already right (and may be the mini player's, when taking over).
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
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

  // Mini player (a native overlay over the app): swiping down hands playback to it; tapping it,
  // or the placeholder left here, hands it back at the position (and playlist video) it reached.
  const [miniId, setMiniId] = useState<number | null>(adoptId);
  const [inlineStart, setInlineStart] = useState<number | null>(adopted?.live?.seconds ?? null);
  const liveRef = useRef({ index, miniId });
  liveRef.current = { index, miniId };
  // The inline player's box, measured for the animation into and out of the mini player.
  const boxRef = useRef<View>(null);
  const foldedRef = useRef(false);
  const measureBox = () =>
    new Promise<MiniRect | null>(resolve => {
      const box = boxRef.current;
      // Folded away (off-screen), there's no spot to animate into.
      if (!box || foldedRef.current) return resolve(null);
      box.measureInWindow((x, y, width, height) => resolve(width > 0 && height > 0 ? { x, y, width, height } : null));
    });
  // How the mini player hands the video back to this player.
  const miniOrigin = () => ({
    returnTo: (atSeconds: number, resumePlaying: boolean, atIndex: number) => {
      setMiniId(null);
      if (atIndex !== liveRef.current.index) {
        setIndex(atIndex);
        setInlineStart(atSeconds);
        setAdvanced(resumePlaying);
        onVideoChange?.(atIndex, urls[atIndex]);
      } else if (inlineState.current === PlayerState.Unstarted) {
        // Not loaded yet (a reopened screen, or a video the mini player moved on to): it loads
        // at the position it's given; play then.
        setInlineStart(atSeconds);
        setAdvanced(resumePlaying);
      } else {
        inlineRef.current?.seekTo(atSeconds);
        if (resumePlaying) inlineRef.current?.play();
      }
    },
    onClosed: () => setMiniId(null),
    measure: measureBox,
    // The listed playlist highlights what the mini player is playing.
    onIndex: (atIndex: number) => {
      setIndex(atIndex);
      setInlineStart(0);
      setAdvanced(false);
    },
  });
  useEffect(() => {
    if (adoptId === null) return;
    if (index !== firstIndex) onVideoChange?.(index, urls[index]);
    miniPlayer.adopt(adoptId, miniOrigin());
    // Once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const minimizing = useRef(false);
  const minimize = async () => {
    if (!miniAvailable || miniId !== null || minimizing.current) return;
    minimizing.current = true;
    const seconds = inlineRef.current?.getCurrentTime() ?? 0;
    const wasPlaying = inlineState.current === PlayerState.Playing || playing;
    inlineRef.current?.pause();
    const rect = await measureBox();
    minimizing.current = false;
    const id = miniPlayer.open(
      {
        ...props,
        playlistStartIndex: index,
        startSeconds: seconds,
        autoPlay: wasPlaying,
      },
      miniOrigin(),
      rect,
      screen?.reopen,
    );
    if (id === null) {
      if (wasPlaying) inlineRef.current?.play();
      return;
    }
    setMiniId(id);
    // Recorded now: closing the screen may unmount this player before the next render.
    liveRef.current.miniId = id;
    // With the playlist listed, the screen stays (showing just the playlist) instead of closing.
    if (!items) screen?.close();
  };
  useEffect(
    () => () => {
      if (liveRef.current.miniId !== null) miniPlayer.detach(liveRef.current.miniId);
    },
    [],
  );

  // Switches to another playlist video and starts it playing.
  const goTo = (next: number) => {
    setInlineStart(null);
    setIndex(next);
    setAdvanced(true);
    // A fullscreen player switching videos starts the new one from the top.
    setResume({ seconds: 0, playing: true });
    onVideoChange?.(next, urls[next]);
  };

  // A row of the listed playlist: plays that video here, taking it back from the mini player.
  const selectFromPanel = (next: number) => {
    if (next === index) {
      // The playing one: bring it back from the mini player where it got to.
      if (miniId !== null) miniPlayer.expand(miniId);
      return;
    }
    if (miniId !== null) miniPlayer.close();
    goTo(next);
  };

  const handleEnd = () => {
    onEnd?.();
    if (autoNext && hasNext) goTo(index + 1);
  };
  const isPlaylist = urls.length > 1;
  const autoNextProps = {
    captionsOn,
    onCaptionsChange: setCaptionsOn,
    autoPlayNext: autoNext,
    onAutoPlayNextChange: isPlaylist ? setAutoNext : undefined,
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
  const pipActionHandler = useRef<(action: string) => void>(() => { });
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

  const panel =
    items && !insideMini ? (
      <PlaylistPanel items={items} current={index} onSelect={selectFromPanel} accentColor={surfaceProps.accentColor ?? DEFAULT_ACCENT} />
    ) : null;
  // While the mini player has the video, the listed playlist takes the whole space (the video
  // area folds away, still mounted so it keeps its player).
  const folded = !!panel && miniId !== null;
  foldedRef.current = folded;
  return (
    <PlayerSettingsProvider>
      {modalOpen && <StatusBar hidden animated />}
      <WithPanel panel={panel}>
      <View
        style={[style ?? styles.defaultFrame, folded && styles.folded]}
        pointerEvents={folded ? 'none' : 'auto'}
        ref={boxRef}
        collapsable={false}
      >
      <PlayerSurface
        {...surfaceProps}
        {...autoNextProps}
        {...pipProps}
        url={current}
        startSeconds={inlineStart ?? surfaceProps.startSeconds}
        // Stays quiet under the fullscreen player (that one plays the next video) and while the
        // mini player has it.
        autoPlay={!modalOpen && miniId === null && (autoPlay || advanced)}
        ref={inlineRef}
        style={StyleSheet.absoluteFill}
        onSwipeDown={modalOpen ? undefined : miniAvailable ? (miniId === null ? minimize : undefined) : insideMini?.onSwipeDown}
        onSwipeUp={toggleFullscreen && !modalOpen && miniId === null ? () => setFullscreen(true) : undefined}
        fullscreen={false}
        onToggleFullscreen={toggleFullscreen}
        onStateChange={next => {
          inlineState.current = next;
          // Another video starting closes the mini player, as on YouTube.
          if (next === PlayerState.Playing && !insideMini && miniId === null && miniPlayer.active()) miniPlayer.close();
          if (modalOpen) return;
          setPlaying(next === PlayerState.Playing);
          onStateChange?.(next);
        }}
        onProgress={event => !modalOpen && onProgress?.(event)}
        onEnd={() => !modalOpen && handleEnd()}
      />
      {miniId !== null && (
        <Pressable
          style={styles.miniPlaceholder}
          onPress={() => miniPlayer.expand(miniId)}
          accessibilityRole="button"
          accessibilityLabel="Bring the video back from the mini player"
        >
          <Text style={styles.miniPlaceholderTitle}>Playing in mini player</Text>
          <Text style={styles.miniPlaceholderHint}>Tap to bring it back</Text>
        </Pressable>
      )}
      </View>
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
            onSwipeDown={pip ? undefined : () => setFullscreen(false)}
            // The Modal stays screen-sized in picture in picture; the window shows its top-left.
            style={pip ? { position: 'absolute', left: 0, top: 0, width: windowSize.width, height: windowSize.height } : StyleSheet.absoluteFill}
            startSeconds={resume.seconds}
            autoPlay={resume.playing}
            fullscreen
            onToggleFullscreen={toggleFullscreen}
            onReady={undefined}
            onStateChange={next => {
              modalState.current = next;
              if (next === PlayerState.Playing && !insideMini && miniId === null && miniPlayer.active()) miniPlayer.close();
              setPlaying(next === PlayerState.Playing);
              onStateChange?.(next);
            }}
            onProgress={onProgress}
            onEnd={handleEnd}
          />
        </Modal>
      )}
      </WithPanel>
    </PlayerSettingsProvider>
  );
});

const styles = StyleSheet.create({
  container: { backgroundColor: BLACK, overflow: 'hidden' },
  // Without a style: full width at 16:9, which suits most videos.
  defaultFrame: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000000' },
  withPanel: { flex: 1 },
  // Out of the layout and off-screen, at its full size: shrinking it would make the YouTube page
  // (and native video surface) re-lay out at 0px and come back zoomed or blank.
  folded: { position: 'absolute', top: 0, left: 0, right: 0, transform: [{ translateX: 100000 }] },
  miniPlaceholder: {
    ...StyleSheet.absoluteFill,
    backgroundColor: BLACK,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniPlaceholderTitle: { color: WHITE, fontSize: 15, fontWeight: '700' },
  miniPlaceholderHint: { color: 'rgba(255,255,255,0.7)', fontSize: 13, marginTop: 4 },
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
  errorOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: 'rgba(0,0,0,0.85)',
  },
  errorText: { color: WHITE, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  errorButton: { marginTop: 14, borderRadius: 20, paddingHorizontal: 22, paddingVertical: 9 },
  errorButtonText: { color: WHITE, fontSize: 14, fontWeight: '700' },
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
