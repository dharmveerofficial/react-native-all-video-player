import { TurboModuleRegistry, type TurboModule } from 'react-native';

// Shows the in-app mini player: a second React surface (the 'AVPMiniPlayer' component) laid over
// the app's window at the given frame, in dp. Needs no app setup. Dragging and pinch-to-resize are
// handled natively; flinging it off a side closes it and emits 'AVPMiniPlayerClosed'.
export interface Spec extends TurboModule {
  /** The overlay can be created on this platform/app. */
  isSupported(): boolean;
  /**
   * Creates the overlay if needed and places it; false if it couldn't be created. With a `from`
   * frame (width > 0) it animates out of it (the original player's spot).
   */
  show(
    x: number,
    y: number,
    width: number,
    height: number,
    fromX: number,
    fromY: number,
    fromWidth: number,
    fromHeight: number,
  ): boolean;
  /** Moves/resizes the overlay. */
  move(x: number, y: number, width: number, height: number): void;
  /** Removes the overlay. */
  hide(): void;
  /** Shrinks/moves the overlay into the given frame (the original player's spot), then removes it. */
  hideTo(x: number, y: number, width: number, height: number): void;
  /** Grows the overlay to cover the whole window (the "max" player); dragging stops. */
  expand(): void;
  /** Shrinks it back to the mini window it had before `expand`. */
  collapse(): void;
  /** Height of the status bar area at the top of the window, in dp. */
  topInset(): number;
}

// `get` so players still work (without the mini player) before the app is rebuilt.
export default TurboModuleRegistry.get<Spec>('AVPMiniPlayer');
