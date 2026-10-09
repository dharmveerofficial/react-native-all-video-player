import { useEffect } from 'react';
import NativeAVPOrientation from './specs/NativeAVPOrientation';

export function useFullscreenOrientation(active: boolean): void {
  useEffect(() => {
    if (!active || !NativeAVPOrientation) return;
    NativeAVPOrientation.lockLandscape();
    return () => NativeAVPOrientation?.restore();
  }, [active]);
}
