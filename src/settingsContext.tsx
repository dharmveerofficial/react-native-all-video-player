import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';

/** Viewer choices from the settings menu, kept for the app session (internal; not exported). */
export interface PlayerSettings {
  captionsOn: boolean;
  autoPlayNext: boolean;
}

interface SettingsStore {
  get(): PlayerSettings;
  set(next: Partial<PlayerSettings>): void;
  subscribe(listener: () => void): () => void;
}

function createStore(initial: PlayerSettings): SettingsStore {
  let settings = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => settings,
    set: next => {
      settings = { ...settings, ...next };
      listeners.forEach(listener => listener());
    },
    subscribe: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

// One store for the whole app, so the choices outlive any single player (e.g. leaving the
// video screen and coming back).
const sessionStore = createStore({ captionsOn: true, autoPlayNext: true });

const SettingsContext = createContext<SettingsStore>(sessionStore);

/** Wraps a player's inline and fullscreen surfaces; used inside VideoPlayer. */
export function PlayerSettingsProvider({ children }: { children: ReactNode }) {
  return <SettingsContext.Provider value={sessionStore}>{children}</SettingsContext.Provider>;
}

export function usePlayerSettings(): [PlayerSettings, (next: Partial<PlayerSettings>) => void] {
  const store = useContext(SettingsContext);
  const settings = useSyncExternalStore(store.subscribe, store.get, store.get);
  return [settings, store.set];
}
