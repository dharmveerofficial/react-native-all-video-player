import { useEffect, useRef } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  useColorScheme,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { youtubeId } from '../youtubeId.ts';
import type { PlaylistItem } from '../types';
import { PlayIcon } from './icons';

const ROW_HEIGHT = 80;

const LIGHT = { text: '#0F0F0F', sub: '#606060', thumb: '#E5E5E5', divider: 'rgba(0,0,0,0.08)' };
const DARK = { text: '#F1F1F1', sub: '#AAAAAA', thumb: '#272727', divider: 'rgba(255,255,255,0.1)' };

interface Props {
  items: PlaylistItem[];
  current: number;
  onSelect: (index: number) => void;
  accentColor: string;
  style?: StyleProp<ViewStyle>;
}

const thumbnailOf = (item: PlaylistItem) => {
  if (item.thumbnail) return item.thumbnail;
  const id = youtubeId(item.url.trim());
  return id ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : undefined;
};

/**
 * The playlist under the player, as on YouTube: what's playing is highlighted, and tapping a row
 * plays that video. Follows the system light/dark appearance.
 */
export function PlaylistPanel({ items, current, onSelect, accentColor, style }: Props) {
  const colors = useColorScheme() === 'dark' ? DARK : LIGHT;
  const listRef = useRef<FlatList<PlaylistItem>>(null);

  // Keeps the playing video in view as the playlist moves on.
  useEffect(() => {
    if (current < 0 || current >= items.length) return;
    listRef.current?.scrollToIndex({ index: current, viewPosition: 0.3, animated: true });
  }, [current, items.length]);

  return (
    <View style={[styles.panel, style]}>
      <View style={[styles.header, { borderBottomColor: colors.divider }]}>
        <Text style={[styles.heading, { color: colors.text }]}>Playlist</Text>
        <Text style={[styles.count, { color: colors.sub }]}>
          {current + 1} / {items.length}
        </Text>
      </View>
      <FlatList
        ref={listRef}
        data={items}
        keyExtractor={(item, index) => `${index}:${item.url}`}
        getItemLayout={(_, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index })}
        onScrollToIndexFailed={() => {}}
        renderItem={({ item, index }) => {
          const playing = index === current;
          const thumbnail = thumbnailOf(item);
          return (
            <Pressable
              onPress={() => onSelect(index)}
              style={({ pressed }) => [
                styles.row,
                playing && { backgroundColor: `${accentColor}1F` },
                pressed && !playing && { backgroundColor: colors.divider },
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: playing }}
              accessibilityLabel={item.subTitle ? `${item.title}, ${item.subTitle}` : item.title}
            >
              <View style={styles.marker}>
                {playing ? (
                  <PlayIcon size={12} color={accentColor} />
                ) : (
                  <Text style={[styles.number, { color: colors.sub }]}>{index + 1}</Text>
                )}
              </View>
              <View style={[styles.thumb, { backgroundColor: colors.thumb }]}>
                {thumbnail ? (
                  <Image source={{ uri: thumbnail }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                ) : (
                  <PlayIcon size={18} color={colors.sub} />
                )}
              </View>
              <View style={styles.texts}>
                <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
                  {item.title}
                </Text>
                {!!item.subTitle && (
                  <Text style={[styles.subTitle, { color: colors.sub }]} numberOfLines={1}>
                    {item.subTitle}
                  </Text>
                )}
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  heading: { fontSize: 16, fontWeight: '700' },
  count: { fontSize: 13 },
  row: { height: ROW_HEIGHT, flexDirection: 'row', alignItems: 'center', paddingRight: 16 },
  marker: { width: 32, alignItems: 'center' },
  number: { fontSize: 12 },
  thumb: {
    width: 112,
    height: 63,
    borderRadius: 8,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  texts: { flex: 1, marginLeft: 12 },
  title: { fontSize: 14, fontWeight: '600', lineHeight: 19 },
  subTitle: { fontSize: 12, marginTop: 3 },
});
