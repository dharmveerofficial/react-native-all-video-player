import { createContext, useContext, type Context } from 'react';

/** The bits of a React Navigation screen the mini player uses. */
interface Navigation {
  canGoBack(): boolean;
  goBack(): void;
  navigate(name: string, params?: object): void;
  isFocused?(): boolean;
}

interface Route {
  name: string;
  params?: object;
}

// React Navigation, when the app uses it: an optional dependency (React Native's Metro config
// allows them), so apps without it still bundle. Its contexts tell a player which screen it's on.
let NavigationContext: Context<Navigation | undefined> | null = null;
let RouteContext: Context<Route | undefined> | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const core = require('@react-navigation/core');
  NavigationContext = core?.NavigationContext ?? null;
  RouteContext = core?.NavigationRouteContext ?? null;
} catch {
  // Not installed.
}
const NoNavigation = createContext<Navigation | undefined>(undefined);
const NoRoute = createContext<Route | undefined>(undefined);

/**
 * How to leave the player's screen when its video moves into the mini player, and how to come
 * back to it from there; null outside a React Navigation screen.
 */
export function useScreenNavigation(): { close: () => void; reopen: () => void } | null {
  const navigation = useContext(NavigationContext ?? NoNavigation);
  const route = useContext(RouteContext ?? NoRoute);
  if (!navigation || !route) return null;
  const { name, params } = route;
  return {
    close: () => {
      if (navigation.isFocused?.() !== false && navigation.canGoBack()) navigation.goBack();
    },
    reopen: () => navigation.navigate(name, params),
  };
}
