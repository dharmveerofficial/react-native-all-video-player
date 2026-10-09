import { PlayerState } from './types.ts';

export interface CoverState {
  visible: boolean;
  hasPlayed: boolean;
}

export const INITIAL_COVER: CoverState = { visible: true, hasPlayed: false };

/**
 * Thumbnail over the start and end, and over pauses when onPause. With onPause,
 * buffering keeps the current look so seeking while paused doesn't flash the
 * video. Mirrors updateCover in the YouTube page.
 */
export function nextCover(prev: CoverState, state: PlayerState, onPause: boolean): CoverState {
  const hasPlayed = prev.hasPlayed || state === PlayerState.Playing;
  if (state === PlayerState.Buffering && onPause) return { visible: prev.visible, hasPlayed };
  const visible =
    state === PlayerState.Ended ||
    (state === PlayerState.Paused && onPause) ||
    !hasPlayed;
  return { visible, hasPlayed };
}
