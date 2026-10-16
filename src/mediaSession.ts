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

// The player the media buttons control: the last one that started playing.
let owner: { id: number; controls: () => MediaControls; playing: boolean } | null = null;
let nextId = 1;

const report = (status: MediaStatus, controls: MediaControls) => {
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
    if (status.playing && owner?.id !== id) owner = { id, controls, playing: true };
    if (owner?.id !== id) return;
    owner = { id, controls, playing: status.playing };
    report(status, controls());
  },

  /** A player went away. */
  release(id: number): void {
    if (owner?.id !== id) return;
    owner = null;
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
      return owner.playing ? controls.pause() : controls.play();
    case 'next':
      return controls.next?.();
    case 'previous':
      return controls.previous?.();
    case 'seek':
      if (event.position !== undefined) controls.seekTo(event.position);
  }
});
