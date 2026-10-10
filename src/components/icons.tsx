import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

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

// One straight arrow pointing left (mirrored for right): a shaft plus a chevron head.
function LineArrow({ length, color, left }: { length: number; color: string; left: boolean }) {
  const thickness = Math.max(2, length * 0.16);
  const head = length * 0.62;
  return (
    <View style={{ width: length, height: length, justifyContent: 'center', transform: [{ scaleX: left ? 1 : -1 }] }}>
      <View
        style={{
          position: 'absolute',
          left: thickness * 0.4,
          right: 0,
          height: thickness,
          borderRadius: thickness / 2,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: length * 0.12,
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

// Two diagonal arrows: out to the top-left and bottom-right corners to enter fullscreen,
// in toward the center to exit.
export function FullscreenIcon({ size, color, exit }: IconProps & { exit: boolean }) {
  const span = size * 1.42;
  const arrow = span * 0.42;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: span,
          height: arrow,
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          transform: [{ rotate: '45deg' }],
        }}
      >
        <LineArrow length={arrow} color={color} left={!exit} />
        <LineArrow length={arrow} color={color} left={exit} />
      </View>
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

// Skip to the next / previous video: a triangle against a bar.
export function TrackIcon({ size, color, next }: IconProps & { next: boolean }) {
  const half = size / 2;
  const bar = <View style={{ width: size * 0.16, height: size, backgroundColor: color, borderRadius: size * 0.04 }} />;
  const triangle = (
    <View
      style={{
        width: 0,
        height: 0,
        borderTopWidth: half,
        borderBottomWidth: half,
        borderTopColor: 'transparent',
        borderBottomColor: 'transparent',
        [next ? 'borderLeftWidth' : 'borderRightWidth']: size * 0.72,
        [next ? 'borderLeftColor' : 'borderRightColor']: color,
      }}
    />
  );
  return (
    <View style={[styles.row, { width: size, height: size, justifyContent: 'center' }]}>
      {next ? triangle : bar}
      {next ? bar : triangle}
    </View>
  );
}

// Gear: a ring with eight teeth (each tooth sits at the top of a rotated full-size box).
export function SettingsIcon({ size, color }: IconProps) {
  const ring = size * 0.68;
  const tooth = size * 0.2;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {[0, 45, 90, 135, 180, 225, 270, 315].map(angle => (
        <View key={angle} style={[StyleSheet.absoluteFill, { alignItems: 'center', transform: [{ rotate: `${angle}deg` }] }]}>
          <View style={{ width: tooth, height: tooth, marginTop: size * 0.04, borderRadius: tooth * 0.2, backgroundColor: color }} />
        </View>
      ))}
      <View style={{ width: ring, height: ring, borderRadius: ring / 2, borderWidth: size * 0.17, borderColor: color }} />
    </View>
  );
}

const styles = StyleSheet.create({
  row:{ flexDirection: 'row', alignItems: 'center' },
});
