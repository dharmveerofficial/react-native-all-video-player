import type * as React from 'react';
import {
  codegenNativeCommands,
  codegenNativeComponent,
  type CodegenTypes,
  type HostComponent,
  type ViewProps,
} from 'react-native';

export interface NativeProps extends ViewProps {
  html: string;
  baseUrl: string;
  onMessage?: CodegenTypes.DirectEventHandler<Readonly<{ data: string }>>;
  onLoadError?: CodegenTypes.DirectEventHandler<Readonly<{ description: string }>>;
}

interface NativeCommands {
  injectJavaScript: (viewRef: React.ElementRef<HostComponent<NativeProps>>, script: string) => void;
}

export const Commands = codegenNativeCommands<NativeCommands>({
  supportedCommands: ['injectJavaScript'],
});

export default codegenNativeComponent<NativeProps>('AVPWebView') as HostComponent<NativeProps>;
