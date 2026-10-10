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
  /** iOS: allow picture in picture for this video. */
  pictureInPicture?: CodegenTypes.WithDefault<boolean, false>;
  /** iOS: start picture in picture by itself when the app goes to the background while playing. */
  autoEnterPictureInPicture?: CodegenTypes.WithDefault<boolean, false>;
  /** iOS: whether picture in picture can start right now. */
  onVideoPictureInPicturePossible?: CodegenTypes.DirectEventHandler<Readonly<{ possible: boolean }>>;
  /** iOS: picture in picture started or stopped. */
  onVideoPictureInPicture?: CodegenTypes.DirectEventHandler<Readonly<{ active: boolean }>>;
}

interface NativeCommands {
  play: (viewRef: React.ElementRef<HostComponent<NativeProps>>) => void;
  pause: (viewRef: React.ElementRef<HostComponent<NativeProps>>) => void;
  seekTo: (viewRef: React.ElementRef<HostComponent<NativeProps>>, seconds: CodegenTypes.Double) => void;
  setRate: (viewRef: React.ElementRef<HostComponent<NativeProps>>, rate: CodegenTypes.Float) => void;
  setMuted: (viewRef: React.ElementRef<HostComponent<NativeProps>>, muted: boolean) => void;
  startPictureInPicture: (viewRef: React.ElementRef<HostComponent<NativeProps>>) => void;
}

export const Commands = codegenNativeCommands<NativeCommands>({
  supportedCommands: ['play', 'pause', 'seekTo', 'setRate', 'setMuted', 'startPictureInPicture'],
});

export default codegenNativeComponent<NativeProps>('AVPVideoView') as HostComponent<NativeProps>;
