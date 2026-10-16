import { createContext } from 'react';
import { DeviceEventEmitter, Dimensions } from 'react-native';
import NativeAVPMiniPlayer from './specs/NativeAVPMiniPlayer';
import type { VideoPlayerProps } from './types';

export interface MiniRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where the mini player has got to. */
export interface MiniLiveState {
  seconds: number;
  playing: boolean;
  index: number;
}

export interface MiniSession {
  id: number;
  /** Props for the mini player: the original player's, at its current video and position. */
  props: VideoPlayerProps;
  /** Reopens the original player's screen once it has closed (React Navigation). */
  reopen?: () => void;
}

interface Origin {
  /** The original player is still on screen: hand the position back to it. */
  returnTo?: (seconds: number, playing: boolean, index: number) => void;
  /** The viewer closed the mini player. */
  onClosed?: () => void;
  /** The mini player moved on to another playlist video. */
  onIndex?: (index: number) => void;
  /** Where the original player is in the window, for animating back into it. */
  measure?: () => Promise<MiniRect | null>;
}

const MARGIN = 12;
// Space kept free at the bottom (e.g. a tab bar).
const BOTTOM_OFFSET = 80;
// The native shrink-back animation's length (plus a little).
const HIDE_ANIMATION_MS = 300;
// Lets a reopened screen finish its opening transition before the mini player animates into it.
const ADOPT_DELAY_MS = 400;

const mediaKey = (props: VideoPlayerProps) =>
  (props.playlist?.length ? props.playlist.map(item => (typeof item === 'string' ? item : item.url)) : [props.url ?? ''])
    .join('\n');

let session: MiniSession | null = null;
let origin: Origin | null = null;
// Shrinking back into the original player (the session ends when that finishes).
let leaving = false;
let nextId = 1;
let expandHandler: (() => void) | null = null;
let liveStateGetter: (() => MiniLiveState) | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());

/**
 * The in-app mini player, shared by the original player (which hands playback over when swiped
 * down) and the mini player's own React surface, which native code lays over the app's window.
 */
export const miniPlayer = {
  supported(): boolean {
    try {
      return !!NativeAVPMiniPlayer?.isSupported();
    } catch {
      return false;
    }
  },

  getSession: (): MiniSession | null => session,
  hasOrigin: (): boolean => !!origin?.returnTo,
  /** A mini player is showing (and not on its way back into its original player). */
  active: (): boolean => !!session && !leaving,

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** Shows the mini player; returns its id, or null if the overlay couldn't be shown. */
  open(props: VideoPlayerProps, from: Origin, rect?: MiniRect | null, reopen?: () => void): number | null {
    if (!NativeAVPMiniPlayer || !miniPlayer.supported()) return null;
    const { width, height } = Dimensions.get('window');
    const w = Math.min(width * 0.5, 260);
    const h = (w * 9) / 16;
    const id = nextId++;
    session = { id, props, reopen };
    leaving = false;
    origin = from;
    emit();
    if (!NativeAVPMiniPlayer.show(
        width - w - MARGIN,
        height - BOTTOM_OFFSET - h,
        w,
        h,
        rect?.x ?? 0,
        rect?.y ?? 0,
        rect?.width ?? 0,
        rect?.height ?? 0,
      )) {
      session = null;
      origin = null;
      emit();
      return null;
    }
    return id;
  },

  /** Grows the overlay to cover the whole window, or shrinks it back to the mini window. */
  setExpanded(expanded: boolean): void {
    if (expanded) NativeAVPMiniPlayer?.expand();
    else NativeAVPMiniPlayer?.collapse();
  },

  topInset(): number {
    try {
      return NativeAVPMiniPlayer?.topInset() ?? 0;
    } catch {
      return 0;
    }
  },

  /**
   * A newly shown player with this session's video: it becomes the original player and the mini
   * player hands the video back to it (once its screen has settled, so it can be measured).
   */
  adopt(id: number, from: Origin): void {
    if (session?.id !== id) return;
    origin = from;
    setTimeout(() => miniPlayer.expand(id), ADOPT_DELAY_MS);
  },

  /** The mini player moved on to another playlist video: its original player follows along. */
  notifyIndex(id: number, index: number): void {
    if (session?.id === id) origin?.onIndex?.(index);
  },

  /** Whether `props` show the same video(s) as the current session. */
  showsSameMedia(props: VideoPlayerProps): boolean {
    if (!session) return false;
    return mediaKey(session.props) === mediaKey(props);
  },

  /** The original player went away (its screen closed); the mini player carries on alone. */
  detach(id: number): void {
    if (session?.id === id) origin = null;
  },

  /** Brings the mini player back: to its original player, or fullscreen if that's gone. */
  expand(id: number): void {
    if (session?.id === id) expandHandler?.();
  },

  /** Set by the mini player's surface: where its player has got to. */
  setLiveStateGetter(getter: (() => MiniLiveState) | null): void {
    liveStateGetter = getter;
  },
  getLiveState: (): MiniLiveState | null => (session ? (liveStateGetter?.() ?? null) : null),

  /** Set by the mini player's surface, which knows its own player. */
  setExpandHandler(handler: (() => void) | null): void {
    expandHandler = handler;
  },

  /**
   * Hands the position back to the original player, which carries on under the overlay while it
   * shrinks back into the player's spot; then ends the session.
   */
  async returnToOrigin(seconds: number, playing: boolean, index: number): Promise<void> {
    const current = session;
    const back = origin?.returnTo;
    const rect = (await origin?.measure?.().catch(() => null)) ?? null;
    if (!current || session !== current) return;
    origin = null;
    leaving = true;
    back?.(seconds, playing, index);
    if (!rect || !NativeAVPMiniPlayer) {
      miniPlayer.end();
      return;
    }
    NativeAVPMiniPlayer.hideTo(rect.x, rect.y, rect.width, rect.height);
    setTimeout(() => {
      if (session !== current) return;
      session = null;
      leaving = false;
      emit();
    }, HIDE_ANIMATION_MS);
  },

  close(): void {
    const closed = origin?.onClosed;
    miniPlayer.end();
    closed?.();
  },

  end(): void {
    session = null;
    leaving = false;
    origin = null;
    NativeAVPMiniPlayer?.hide();
    emit();
  },

};

// The viewer flung the mini player off a side (native code already removed it).
DeviceEventEmitter.addListener('AVPMiniPlayerClosed', () => {
  if (session) miniPlayer.close();
});

/**
 * Set inside the mini player's own surface (null elsewhere), so its player doesn't offer to
 * minimize again; in the max player, swiping down shrinks it back to the mini window instead.
 */
export const InsideMiniPlayer = createContext<{ onSwipeDown?: () => void } | null>(null);
