export interface YouTubeHtmlOptions {
  /** Must already be validated (isValidVideoId): it is inlined into the page. */
  videoId: string;
  origin: string;
  startSeconds: number;
  hideBranding: boolean;
}

export const YOUTUBE_ERROR_MESSAGES: Record<number, string> = {
  2: 'Invalid video id',
  5: 'The video cannot be played in an HTML5 player',
  100: 'Video not found, removed, or private',
  101: 'The owner does not allow this video to be embedded',
  150: 'The owner does not allow this video to be embedded',
  152: 'The owner does not allow this video to be embedded',
  153: 'YouTube rejected the player configuration',
};

/**
 * Places the iframe so the 16:9 video fills the box while YouTube's overlays,
 * pinned to the iframe's edges (title bar, logo, pause strip), fall outside it:
 * the iframe is as wide as the fitted video and `edge` px taller at top and
 * bottom, so YouTube letterboxes the video to the same spot.
 */
export const PLAYER_FRAME_JS = `function playerFrame(boxWidth, boxHeight, cropEdges) {
  if (!cropEdges || !(boxWidth > 0) || !(boxHeight > 0)) {
    return { left: 0, top: 0, width: Math.max(0, boxWidth), height: Math.max(0, boxHeight) };
  }
  var videoWidth = Math.min(boxWidth, boxHeight * 16 / 9);
  var edge = Math.round(Math.min(240, Math.max(80, videoWidth * 9 / 16 * 0.6)));
  return {
    left: Math.round((boxWidth - videoWidth) / 2),
    top: -edge,
    width: Math.round(videoWidth),
    height: Math.round(boxHeight) + 2 * edge
  };
}`;

export function youtubeHtml(options: YouTubeHtmlOptions): string {
  const { videoId, origin, startSeconds, hideBranding } = options;
  const start = Math.max(0, Math.floor(startSeconds));
  const flag = hideBranding ? 'true' : 'false';

  return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}
#player{position:absolute;left:0;top:0;width:100%;height:100%;border:0}
#cover{position:absolute;top:0;left:0;width:100%;height:100%;z-index:1;background:#000
  url('https://i.ytimg.com/vi/${videoId}/hqdefault.jpg') center/cover no-repeat}
#cover.hidden{display:none}
#shield{position:absolute;top:0;left:0;width:100%;height:100%;z-index:2}</style><style id="frame"></style>
</head><body><div id="player"></div><div id="cover"${hideBranding ? '' : ' class="hidden"'}></div><div id="shield"></div>
<script>
var player, ready = false;
var cover = document.getElementById('cover');
${PLAYER_FRAME_JS}
function layout() {
  var f = playerFrame(window.innerWidth, window.innerHeight, ${flag});
  document.getElementById('frame').textContent = '#player{left:' + f.left + 'px;top:' + f.top +
    'px;width:' + f.width + 'px;height:' + f.height + 'px}';
}
layout();
window.addEventListener('resize', layout);
function send(m) { window.AVPBridge.postMessage(JSON.stringify(m)); }
// Thumbnail over everything but playback: hides YouTube's start, pause and end
// screens. Buffering keeps the current look so playback stalls don't flash it.
function updateCover(state) {
  if (state === 3) return;
  cover.className = ${flag} && state !== 1 ? '' : 'hidden';
}
function onYouTubeIframeAPIReady() {
  player = new YT.Player('player', {
    videoId: '${videoId}',
    width: '100%', height: '100%',
    playerVars: { controls: 0, disablekb: 1, fs: 0, rel: 0, playsinline: 1, iv_load_policy: 3,
                  modestbranding: 1, cc_load_policy: 0, start: ${start}, origin: ${JSON.stringify(origin)} },
    events: {
      onReady: function () { ready = true; send({ type: 'ready', duration: player.getDuration() }); },
      onStateChange: function (e) { updateCover(e.data); send({ type: 'state', state: e.data }); },
      onError: function (e) { send({ type: 'error', code: e.data }); }
    }
  });
  setInterval(function () {
    if (ready) send({ type: 'time', current: player.getCurrentTime(), duration: player.getDuration() });
  }, 500);
}
var tag = document.createElement('script');
tag.src = 'https://www.youtube.com/iframe_api';
tag.onerror = function () { send({ type: 'error', message: 'Could not load the YouTube player' }); };
document.head.appendChild(tag);
</script></body></html>`;
}
