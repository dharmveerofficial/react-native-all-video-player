import { DeviceEventEmitter } from 'react-native';
import NativeAVPMediaSession from './specs/NativeAVPMediaSession';

/** What headphone / Bluetooth buttons can do to a player. */
export interface MediaControls {
  play: () => void;
  pause: () => void;
  seekTo: (seconds: number) => void;
  next?: () => void;
  previous?: () => void;
}

export interface MediaStatus {
  playing: boolean;
  position: number;
  duration: number;
}

type MediaCommand = { command: 'play' | 'pause' | 'toggle' | 'next' | 'previous' | 'seek'; position?: number };

interface Player {
  id: number;
  status: MediaStatus;
  controls: () => MediaControls;
  // When it last started playing, to pick who takes over when the owner goes away.
  playedAt: number;
}

// Every mounted player's last report, and the one the media buttons control: the last one that
// started playing.
const players = new Map<number, Player>();
let owner: Player | null = null;
let nextId = 1;
let clock = 0;

const report = (player: Player) => {
  const { status } = player;
  const controls = player.controls();
  try {
    NativeAVPMediaSession?.update(status.playing, status.position, status.duration, !!controls.previous, !!controls.next);
  } catch {
    // An app built without the module: no media buttons.
  }
};

export const mediaSession = {
  newId: (): number => nextId++,

  /** A player reports its state: playing takes the media session; others only update their own. */
  update(id: number, status: MediaStatus, controls: () => MediaControls): void {
    const previous = players.get(id);
    const startedPlaying = status.playing && !previous?.status.playing;
    const player: Player = { id, status, controls, playedAt: startedPlaying ? ++clock : (previous?.playedAt ?? 0) };
    players.set(id, player);
    if (status.playing && owner?.id !== id) owner = player;
    if (owner?.id !== id) return;
    owner = player;
    report(player);
  },

  /**
   * A player went away. If it had the media session, the player that last started playing (e.g.
   * the inline one after fullscreen closes) takes it over, so the buttons keep working.
   */
  release(id: number): void {
    players.delete(id);
    if (owner?.id !== id) return;
    let next: Player | null = null;
    players.forEach(player => {
      if (!next || player.playedAt > next.playedAt) next = player;
    });
    owner = next;
    if (next) {
      report(next);
      return;
    }
    try {
      NativeAVPMediaSession?.release();
    } catch {
      // As above.
    }
  },
};

DeviceEventEmitter.addListener('AVPMediaCommand', (event: MediaCommand) => {
  if (!owner) return;
  const controls = owner.controls();
  switch (event.command) {
    case 'play':
      return controls.play();
    case 'pause':
      return controls.pause();
    case 'toggle':
      return owner.status.playing ? controls.pause() : controls.play();
    case 'next':
      return controls.next?.();
    case 'previous':
      return controls.previous?.();
    case 'seek':
      if (event.position !== undefined) controls.seekTo(event.position);
  }
});
