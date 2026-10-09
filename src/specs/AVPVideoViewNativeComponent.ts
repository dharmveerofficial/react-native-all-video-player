import type * as React from 'react';
import {
  codegenNativeCommands,
  codegenNativeComponent,
  type CodegenTypes,
  type HostComponent,
  type ViewProps,
} from 'react-native';

export interface NativeProps extends ViewProps {
  source: string;
  /** Grab a frame from the video and report it through onVideoPoster. */
  grabPoster?: CodegenTypes.WithDefault<boolean, false>;
  onVideoReady?: CodegenTypes.DirectEventHandler<Readonly<{ duration: CodegenTypes.Double }>>;
  onVideoState?: CodegenTypes.DirectEventHandler<Readonly<{ state: CodegenTypes.Int32 }>>;
  onVideoProgress?: CodegenTypes.DirectEventHandler<
    Readonly<{ currentTime: CodegenTypes.Double; duration: CodegenTypes.Double }>
  >;
  onVideoError?: CodegenTypes.DirectEventHandler<Readonly<{ message: string }>>;
  /** A file:// URI of the grabbed frame (JPEG). */
  onVideoPoster?: CodegenTypes.DirectEventHandler<Readonly<{ uri: string }>>;
}

interface NativeCommands {
  play: (viewRef: React.ElementRef<HostComponent<NativeProps>>) => void;
  pause: (viewRef: React.ElementRef<HostComponent<NativeProps>>) => void;
  seekTo: (viewRef: React.ElementRef<HostComponent<NativeProps>>, seconds: CodegenTypes.Double) => void;
  setRate: (viewRef: React.ElementRef<HostComponent<NativeProps>>, rate: CodegenTypes.Float) => void;
  setMuted: (viewRef: React.ElementRef<HostComponent<NativeProps>>, muted: boolean) => void;
}

export const Commands = codegenNativeCommands<NativeCommands>({
  supportedCommands: ['play', 'pause', 'seekTo', 'setRate', 'setMuted'],
});

export default codegenNativeComponent<NativeProps>('AVPVideoView') as HostComponent<NativeProps>;
