import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  AppRegistry,
  BackHandler,
  Pressable,
  StyleSheet,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { InsideMiniPlayer, miniPlayer } from '../miniPlayerStore';
import { PlayerState, type VideoPlayerRef } from '../types';
import { ChevronIcon, PauseIcon, PlayIcon } from './icons';
import { VideoPlayer } from './VideoPlayer';

const WHITE = '#FFFFFF';
export const MINI_PLAYER_COMPONENT = 'AVPMiniPlayer';

/**
 * The mini player's own React surface, laid over the app's window by native code (exactly the
 * mini window's size). Native code drags it (snapping to the nearer side, closing when flung off
 * one) and pinch-resizes it. Tapping it hands the video back to its original player; if that
 * screen has closed, it's reopened (React Navigation; its player then takes the video over), or
 * else the overlay grows into a full-window "max" player (swipe down or back to shrink it again).
 */
function MiniPlayerRoot() {
  const session = useSyncExternalStore(miniPlayer.subscribe, miniPlayer.getSession, miniPlayer.getSession);
  const miniRef = useRef<VideoPlayerRef>(null);
  const [playing, setPlaying] = useState(!!session?.props.autoPlay);
  const [fullscreen, setFullscreen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const live = useRef({ playing, index: session?.props.playlistStartIndex ?? 0 });
  live.current.playing = playing;
  const { width } = useWindowDimensions();

  useEffect(() => {
    live.current.index = session?.props.playlistStartIndex ?? 0;
    setPlaying(!!session?.props.autoPlay);
    setFullscreen(false);
    setExpanded(false);
  }, [session]);

  const grow = (on: boolean) => {
    setExpanded(on);
    miniPlayer.setExpanded(on);
  };
  const maximize = () => {
    if (!miniPlayer.hasOrigin()) {
      // The original screen has closed: the app reopens it (its player adopts this session).
      const reopen = miniPlayer.getSession()?.reopen;
      if (reopen) reopen();
      else grow(true);
      return;
    }
    // The original player takes over while this one shrinks back into it.
    const position = miniRef.current?.getCurrentTime() ?? 0;
    const wasPlaying = live.current.playing;
    miniRef.current?.pause();
    void miniPlayer.returnToOrigin(position, wasPlaying, live.current.index);
  };
  const maximizeRef = useRef(maximize);
  maximizeRef.current = maximize;
  useEffect(() => {
    miniPlayer.setExpandHandler(() => maximizeRef.current());
    miniPlayer.setLiveStateGetter(() => ({
      seconds: miniRef.current?.getCurrentTime() ?? 0,
      playing: live.current.playing,
      index: live.current.index,
    }));
    return () => {
      miniPlayer.setExpandHandler(null);
      miniPlayer.setLiveStateGetter(null);
    };
  }, []);

  // Back shrinks the max player to the mini window (fullscreen handles back itself).
  useEffect(() => {
    if (!expanded || fullscreen) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      grow(false);
      return true;
    });
    return () => subscription.remove();
  }, [expanded, fullscreen]);

  const context = useMemo(() => ({ onSwipeDown: expanded ? () => grow(false) : undefined }), [expanded]);
  const topInset = useMemo(() => (expanded ? miniPlayer.topInset() : 0), [expanded]);

  if (!session) return null;
  const { props } = session;
  const togglePlay = () => (playing ? miniRef.current?.pause() : miniRef.current?.play());

  return (
    <View style={[styles.root, expanded ? { paddingTop: topInset } : styles.rounded]}>
      <View style={expanded ? { width, height: (width * 9) / 16 } : StyleSheet.absoluteFill}>
        <InsideMiniPlayer.Provider value={context}>
          <VideoPlayer
            {...props}
            key={session.id}
            ref={miniRef}
            showControls={expanded || fullscreen}
            style={StyleSheet.absoluteFill}
            onFullscreenChange={on => {
              setFullscreen(on);
              props.onFullscreenChange?.(on);
            }}
            onStateChange={state => {
              // Buffering doesn't change whether it's meant to be playing.
              if (state !== PlayerState.Buffering) setPlaying(state === PlayerState.Playing);
              props.onStateChange?.(state);
            }}
            onVideoChange={(index, url) => {
              live.current.index = index;
              miniPlayer.notifyIndex(session.id, index);
              props.onVideoChange?.(index, url);
            }}
          />
        </InsideMiniPlayer.Provider>
        {!expanded && (
          <>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={maximize}
              accessibilityRole="button"
              accessibilityLabel="Maximize video"
            />
            <TouchableOpacity
              style={[styles.button, styles.topRight]}
              onPress={() => miniPlayer.close()}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Close video"
            >
              <View style={[styles.closeBar, styles.rotateRight]} />
              <View style={[styles.closeBar, styles.rotateLeft]} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.bottomLeft]}
              onPress={togglePlay}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={playing ? 'Pause' : 'Play'}
            >
              {playing ? <PauseIcon size={14} color={WHITE} /> : <PlayIcon size={15} color={WHITE} />}
            </TouchableOpacity>
          </>
        )}
      </View>
      {expanded && !fullscreen && (
        <View style={styles.bar}>
          <TouchableOpacity
            style={styles.barButton}
            onPress={() => grow(false)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Minimize video"
          >
            <ChevronIcon size={26} color={WHITE} up={false} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.barButton}
            onPress={() => miniPlayer.close()}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Close video"
          >
            <View style={[styles.closeBar, styles.closeBarLarge, styles.rotateRight]} />
            <View style={[styles.closeBar, styles.closeBarLarge, styles.rotateLeft]} />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

let registered = false;

/** Registers the mini player's surface component, which native code runs over the app. */
export function registerMiniPlayer(): void {
  if (registered) return;
  registered = true;
  AppRegistry.registerComponent(MINI_PLAYER_COMPONENT, () => MiniPlayerRoot);
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000', overflow: 'hidden' },
  rounded: { borderRadius: 10 },
  button: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  topRight: { right: 6, top: 6 },
  bottomLeft: { left: 6, bottom: 6 },
  bar: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 8, paddingVertical: 6 },
  barButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  closeBar: { position: 'absolute', width: 14, height: 2, borderRadius: 1, backgroundColor: WHITE },
  closeBarLarge: { width: 20, height: 2.5 },
  rotateRight: { transform: [{ rotate: '45deg' }] },
  rotateLeft: { transform: [{ rotate: '-45deg' }] },
});
