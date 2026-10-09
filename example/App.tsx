import { useRef, useState } from 'react';
import { Button, StyleSheet, Text, View } from 'react-native';
import { VideoPlayer, type VideoPlayerRef } from '../src';

const SOURCES = {
  YouTube: 'https://youtu.be/dQw4w9WgXcQ',
  MP4: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
  HLS: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
};

export default function App() {
  const player = useRef<VideoPlayerRef>(null);
  const [source, setSource] = useState(SOURCES.YouTube);
  const [status, setStatus] = useState('Loading…');

  return (
    <View style={styles.screen}>
      <VideoPlayer
        ref={player}
        source={source}
        style={styles.player}
        onReady={({ duration }) => setStatus(`Ready — ${Math.round(duration)}s`)}
        onStateChange={state => setStatus(`State ${state}`)}
        onFullscreenChange={fullscreen => setStatus(fullscreen ? 'Fullscreen' : 'Inline')}
        onError={error => setStatus(`Error: ${error.message}`)}
      />
      <View style={styles.panel}>
        <Text style={styles.status}>{status}</Text>
        <View style={styles.row}>
          {Object.entries(SOURCES).map(([label, url]) => (
            <Button key={label} title={label} onPress={() => setSource(url)} />
          ))}
        </View>
        <View style={styles.row}>
          <Button title="Play" onPress={() => player.current?.play()} />
          <Button title="Pause" onPress={() => player.current?.pause()} />
          <Button title="Jump to 1:00" onPress={() => player.current?.seekTo(60)} />
          <Button title="Fullscreen" onPress={() => player.current?.setFullscreen(true)} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingTop: 48, backgroundColor: '#F4F2FA' },
  player: { width: '100%', aspectRatio: 16 / 9 },
  panel: { padding: 16, rowGap: 12 },
  status: { color: '#1F2333' },
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8 },
});
