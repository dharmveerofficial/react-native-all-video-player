import { TurboModuleRegistry, type TurboModule } from 'react-native';

// Android only: picture in picture shrinks the whole activity. iOS uses the video view's own
// AVPictureInPictureController instead, so this module is null there.
export interface Spec extends TurboModule {
  /** Android 8+, the device allows it, and the activity supports it (the library's Gradle step marks it). */
  isSupported(): boolean;
  /** Enters picture in picture with that aspect ratio; false if it couldn't. */
  enter(width: number, height: number): boolean;
  /** Enter automatically when the user leaves the app (Home, Recents) while enabled. */
  setAutoEnter(enabled: boolean, width: number, height: number): void;
  /**
   * The window's buttons: play/pause, plus previous/next for a playlist (disabled at the ends)
   * or skip back/forward. Taps emit 'AVPPictureInPictureAction' { action }.
   */
  setActions(playing: boolean, playlist: boolean, hasPrevious: boolean, hasNext: boolean): void;
  // NativeEventEmitter plumbing; the module emits 'AVPPictureInPictureChange' { active, dismissed }.
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

export default TurboModuleRegistry.get<Spec>('AVPPictureInPicture');
