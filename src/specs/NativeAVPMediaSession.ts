import { TurboModuleRegistry, type TurboModule } from 'react-native';

// The system media session, so headphone / Bluetooth / earphone buttons (and, on iOS, the lock
// screen and Control Center) control the player that's playing. Button presses arrive as
// 'AVPMediaCommand' events: { command: 'play' | 'pause' | 'toggle' | 'next' | 'previous' | 'seek',
// position?: seconds }. Unplugging headphones sends 'pause'.
export interface Spec extends TurboModule {
  /** Takes (or keeps) the media session and reports the playing player's state; times in seconds. */
  update(playing: boolean, position: number, duration: number, hasPrevious: boolean, hasNext: boolean): void;
  /** Gives the media session up. */
  release(): void;
}

// `get` so players still work (without media buttons) before the app is rebuilt.
export default TurboModuleRegistry.get<Spec>('AVPMediaSession');
