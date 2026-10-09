import { TurboModuleRegistry, type TurboModule } from 'react-native';

export interface Spec extends TurboModule {
  lockLandscape(): void;
  restore(): void;
}

// `get` so fullscreen still works (without rotating) before the app is rebuilt.
export default TurboModuleRegistry.get<Spec>('AVPOrientation');
