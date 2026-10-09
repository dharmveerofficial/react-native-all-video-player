# react-native-all-video-player

One video player for React Native. Pass **any video URL**: YouTube links, mp4/mov/webm files, HLS (`.m3u8`) and DASH (`.mpd`) streams, signed stream links and S3/CDN files. You get the same custom controls and fullscreen for all of them.

- **Native playback** for video files and streams: ExoPlayer (Media3) on Android, AVPlayer on iOS.
- **YouTube** plays through the official [IFrame Player API](https://developers.google.com/youtube/iframe_api_reference). YouTube has no native player you can embed. Its controls, title bar, logo and "More videos" strip are hidden, and taps never reach YouTube's UI.
- **Custom controls:** play/pause, ±10 s skip, draggable seek bar, time, speed and fullscreen.
- **Built-in fullscreen:** rotates to landscape, hides the status bar, handles Android's back button, and restores everything on exit.
- **One install:** nothing else to add, no AppDelegate/MainActivity changes.

> **Before you ship:** YouTube's [API Terms](https://developers.google.com/youtube/terms/developer-policies) don't allow obscuring YouTube branding in embedded players. Hiding it (`hideYouTubeBranding`, on by default) is your call. Set it to `false` to show YouTube's overlays normally.

## Installation

```sh
npm install react-native-all-video-player
cd ios && pod install
```

Rebuild the app afterwards (`npx react-native run-android` / `run-ios`). Requires the New Architecture and React Native 0.81+. Expo works with a development build (`npx expo prebuild`), not Expo Go.

On Android the player uses Media3 1.11.1. To use another version, set `media3Version` in your app's `android/build.gradle`:

```groovy
buildscript {
  ext {
    media3Version = "1.11.1"
  }
}
```

## Usage

```tsx
import { VideoPlayer } from 'react-native-all-video-player';

<VideoPlayer source="https://youtu.be/dQw4w9WgXcQ" style={{ width: '100%', aspectRatio: 16 / 9 }} />;
<VideoPlayer source="https://cdn.example.com/lessons/intro.mp4" style={{ width: '100%', aspectRatio: 16 / 9 }} />;
<VideoPlayer source="https://cdn.example.com/live/index.m3u8" style={{ width: '100%', aspectRatio: 16 / 9 }} />;
```

Give the player a size; 16:9 suits most videos.

### Supported sources

| Source | Android | iOS |
|---|---|---|
| YouTube id or link (watch, youtu.be, shorts, embed, live) | ✓ | ✓ |
| MP4 / MOV | ✓ | ✓ |
| WebM / MKV | ✓ | — |
| HLS (`.m3u8`) | ✓ | ✓ |
| DASH (`.mpd`) | ✓ | — |

- On Android, streams are recognised by their `.m3u8` / `.mpd` extension; links without one play as regular files. iOS also detects HLS from the server's response.
- Seeking needs a server that supports HTTP range requests.
- Plain `http://` URLs need cleartext traffic allowed on Android and an App Transport Security exception on iOS.
- Playback pauses when the app goes to the background.
- On iOS, playing a video file sets the app's audio session to playback, so sound plays even with the silent switch on.

### Controlling it from code

```tsx
const player = useRef<VideoPlayerRef>(null);

<VideoPlayer ref={player} source="https://cdn.example.com/a.mp4" onEnd={() => console.log('done')} />;

player.current?.seekTo(90);
player.current?.play();
```

### Fullscreen

The fullscreen button (or `ref.setFullscreen(true)`) opens the player in a full-screen Modal, rotated to landscape, continuing from the same position. Back, or the button again, returns to the inline player. The screen goes back to its previous orientation, so a portrait-only app stays portrait-only. Entering fullscreen starts a second player, so a spinner shows briefly.

See [`example/App.tsx`](example/App.tsx) for a runnable screen.

## Props

Props marked <sup>*</sup> are required.

| Prop | Type | Default | |
|---|---|---|---|
| `source` <sup>*</sup> | `string` | — | Any video URL, or a YouTube id/link. |
| `autoPlay` | `boolean` | `false` | Play as soon as the player is ready. |
| `startSeconds` | `number` | `0` | Start position. |
| `hideYouTubeBranding` | `boolean` | `true` | YouTube only: clip YouTube's overlays and cover its start/end screens with the thumbnail. |
| `showControls` | `boolean` | `true` | `false` gives a bare player you drive through the ref. |
| `playbackRates` | `number[]` | `[1, 1.25, 1.5, 2]` | Speeds the speed button cycles through; `[]` hides it. |
| `seekStepSeconds` | `number` | `10` | Skip buttons' step; `0` hides them. |
| `accentColor` | `string` | `#7C3AED` | Seek bar color. |
| `allowFullscreen` | `boolean` | `true` | Show the fullscreen button. |
| `onFullscreenChange` | `(fullscreen: boolean) => void` | — | |
| `style` | `ViewStyle` | — | Size and position. |
| `renderLoading` | `() => ReactNode` | spinner | Shown while loading/buffering. |
| `onReady` | `({ duration }) => void` | — | `duration` is `0` for live streams. |
| `onStateChange` | `(state: PlayerState) => void` | — | `Unstarted / Ended / Playing / Paused / Buffering / Cued`. |
| `onProgress` | `({ currentTime, duration }) => void` | — | About twice a second. |
| `onEnd` | `() => void` | — | |
| `onError` | `({ code?, message }) => void` | — | See [Errors](#errors). |

## Ref

| Method | |
|---|---|
| `play()` / `pause()` | |
| `seekTo(seconds)` | Clamped to the video length. |
| `setPlaybackRate(rate)` | |
| `mute()` / `unMute()` | |
| `getCurrentTime()` / `getDuration()` | Last reported values, in seconds. |
| `setFullscreen(on)` | Enter or leave fullscreen. |

## Types

```ts
import {
  PlayerState,
  type PlayerError,
  type ProgressEvent,
  type VideoPlayerProps,
  type VideoPlayerRef,
} from 'react-native-all-video-player';
```

`PlayerState` has the values `Unstarted` (-1), `Ended` (0), `Playing` (1), `Paused` (2), `Buffering` (3) and `Cued` (5). They're the same for every source.

## Helpers

```ts
import { resolveSource, youtubeId, isValidVideoId, formatTime } from 'react-native-all-video-player';

resolveSource('https://youtu.be/dQw4w9WgXcQ');  // { kind: 'youtube', videoId: 'dQw4w9WgXcQ' }
resolveSource('https://cdn.example.com/a.mp4'); // { kind: 'video', url: 'https://cdn.example.com/a.mp4' }
resolveSource('not a url');                     // null
formatTime(3725);                               // '1:02:05'
```

## Errors

Video files and streams report a `message` and no `code`. On Android the message is one of "A network error stopped the video from loading", "The video link is invalid or has expired" or "The video format is not supported", falling back to the player's own message. On iOS it is the system's error description. A `source` that is neither a YouTube video nor an http(s) URL reports "Not a YouTube link or a video URL".

YouTube reports a `code`:

| `code` | Meaning |
|---|---|
| `2` | Invalid video id. |
| `5` | Can't be played in an HTML5 player. |
| `100` | Not found, removed, or **private**. |
| `101`, `150`, `152` | The owner disabled embedding. |
| `153` | YouTube rejected the player configuration. |
| none | The YouTube player failed to load (e.g. offline). |

Private YouTube videos can't be embedded anywhere; use *unlisted* ones instead.

## Development

```sh
npm install
npm test
npm run typecheck
npm run build
```

## License

MIT
