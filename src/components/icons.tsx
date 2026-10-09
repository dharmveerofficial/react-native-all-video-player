import { Image, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { FORWARD_10, FORWARD_ARROW, REPLAY_10, REPLAY_ARROW } from './iconImages';

interface IconProps {
  size: number;
  color: string;
}

export function PlayIcon({ size, color }: IconProps) {
  const half = size / 2;
  return (
    <View
      style={{
        width: 0,
        height: 0,
        marginLeft: size * 0.15,
        borderTopWidth: half,
        borderBottomWidth: half,
        borderLeftWidth: size * 0.85,
        borderTopColor: 'transparent',
        borderBottomColor: 'transparent',
        borderLeftColor: color,
      }}
    />
  );
}

export function PauseIcon({ size, color }: IconProps) {
  const bar: ViewStyle = { width: size * 0.28, height: size, backgroundColor: color, borderRadius: size * 0.05 };
  return (
    <View style={[styles.row, { width: size, justifyContent: 'space-between' }]}>
      <View style={bar} />
      <View style={bar} />
    </View>
  );
}

export function ReplayIcon({ size, color }: IconProps) {
  return <Text style={{ color, fontSize: size * 1.1, lineHeight: size * 1.25, fontWeight: '700' }}>↻</Text>;
}

// Material replay_10 / forward_10; other steps draw the number on the plain arrow.
export function SkipIcon({ size, color, seconds, forward }: IconProps & { seconds: number; forward: boolean }) {
  const exact = seconds === 10;
  const source = exact ? (forward ? FORWARD_10 : REPLAY_10) : forward ? FORWARD_ARROW : REPLAY_ARROW;
  const fontSize = size * 0.25;
  return (
    <View style={{ width: size, height: size }}>
      <Image source={source} style={{ width: size, height: size, tintColor: color }} />
      {!exact && (
        <Text
          style={[
            styles.skipNumber,
            { color, fontSize, lineHeight: fontSize * 1.1, top: size * 0.58 - fontSize * 0.55 },
          ]}
          numberOfLines={1}
        >
          {seconds}
        </Text>
      )}
    </View>
  );
}

// Four corner brackets: pointing out for "enter", in for "exit".
export function FullscreenIcon({ size, color, exit }: IconProps & { exit: boolean }) {
  const arm = size * 0.36;
  const thickness = Math.max(2, size * 0.1);
  const corner = (vertical: 'top' | 'bottom', horizontal: 'left' | 'right'): ViewStyle => {
    const v = exit ? (vertical === 'top' ? 'bottom' : 'top') : vertical;
    const h = exit ? (horizontal === 'left' ? 'right' : 'left') : horizontal;
    return {
      position: 'absolute',
      width: arm,
      height: arm,
      [vertical]: 0,
      [horizontal]: 0,
      borderColor: color,
      [`border${v[0].toUpperCase()}${v.slice(1)}Width`]: thickness,
      [`border${h[0].toUpperCase()}${h.slice(1)}Width`]: thickness,
    } as ViewStyle;
  };
  return (
    <View style={{ width: size, height: size }}>
      <View style={corner('top', 'left')} />
      <View style={corner('top', 'right')} />
      <View style={corner('bottom', 'left')} />
      <View style={corner('bottom', 'right')} />
    </View>
  );
}

// Left arrow: a shaft plus a chevron (a square showing two borders, turned 45°).
export function BackIcon({ size, color }: IconProps) {
  const thickness = Math.max(2, size * 0.11);
  const head = size * 0.5;
  return (
    <View style={{ width: size, height: size, justifyContent: 'center' }}>
      <View
        style={{
          position: 'absolute',
          left: size * 0.12,
          right: size * 0.08,
          height: thickness,
          borderRadius: thickness / 2,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: size * 0.14,
          width: head,
          height: head,
          borderLeftWidth: thickness,
          borderBottomWidth: thickness,
          borderColor: color,
          transform: [{ rotate: '45deg' }],
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  skipNumber: { position: 'absolute', left: 0, right: 0, textAlign: 'center', fontWeight: '700' },
});
