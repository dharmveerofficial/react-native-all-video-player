export interface YouTubeHtmlOptions {
  /** Must already be validated (isValidVideoId): it is inlined into the page. */
  videoId: string;
  origin: string;
  startSeconds: number;
  hideBranding: boolean;
  /** Also cover pauses mid-video, not just the start and end. */
  thumbnailOnPause: boolean;
  /** Cover image in place of YouTube's; passing one turns the cover on. */
  thumbnail?: string;
  /** Start playing as soon as the player is ready, from inside the page. */
  autoPlay?: boolean;
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

/** Percent-encodes what could break out of a CSS url("...") inside a <style>. */
export function cssUrl(url: string): string {
  return url.replace(/["'()\\<>\s]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
}

export function youtubeHtml(options: YouTubeHtmlOptions): string {
  const { videoId, origin, startSeconds, hideBranding, thumbnailOnPause, thumbnail, autoPlay = false } = options;
  const start = Math.max(0, Math.floor(startSeconds));
  const flag = hideBranding ? 'true' : 'false';
  const onPause = thumbnailOnPause ? 'true' : 'false';
  const coverOn = hideBranding || !!thumbnail;
  const image = thumbnail ? cssUrl(thumbnail) : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

  return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}
#player{position:absolute;left:0;top:0;width:100%;height:100%;border:0}
#cover{position:absolute;top:0;left:0;width:100%;height:100%;z-index:1;background:#000
  url("${image}") center/cover no-repeat}
#cover.hidden{display:none}
#shield{position:absolute;top:0;left:0;width:100%;height:100%;z-index:2}</style><style id="frame"></style>
</head><body><div id="player"></div><div id="cover"${coverOn ? '' : ' class="hidden"'}></div><div id="shield"></div>
<script>
var player, ready = false, hasPlayed = false;
var cover = document.getElementById('cover');
${PLAYER_FRAME_JS}
// Sizes in px from the window: Android WebView can keep html/body at 0px tall
// when the page loads before the view is laid out, collapsing 100% heights.
function layout() {
  var w = window.innerWidth, h = window.innerHeight;
  var f = playerFrame(w, h, ${flag});
  document.getElementById('frame').textContent = '#player{left:' + f.left + 'px;top:' + f.top +
    'px;width:' + f.width + 'px;height:' + f.height + 'px}' +
    '#cover,#shield{width:' + w + 'px;height:' + h + 'px}';
}
layout();
window.addEventListener('resize', layout);
function send(m) { window.AVPBridge.postMessage(JSON.stringify(m)); }
// Thumbnail over YouTube's start and end screens, and over pauses when onPause.
// With onPause, buffering keeps the current look so seeking while paused
// doesn't flash the video.
function updateCover(state) {
  if (state === 1) hasPlayed = true;
  if (state === 3 && ${onPause}) return;
  var show = ${coverOn} && (state === 0 || (state === 2 && ${onPause}) || (!hasPlayed && state !== 1));
  cover.className = show ? '' : 'hidden';
}
function onYouTubeIframeAPIReady() {
  player = new YT.Player('player', {
    videoId: '${videoId}',
    width: '100%', height: '100%',
    playerVars: { controls: 0, disablekb: 1, fs: 0, rel: 0, playsinline: 1, iv_load_policy: 3,
                  modestbranding: 1, cc_load_policy: 0, start: ${start}, origin: ${JSON.stringify(origin)} },
    events: {
      onReady: function () {
        ready = true;
        send({ type: 'ready', duration: player.getDuration() });
        // Started here, not by a command from the app: commands can't arrive while the app is
        // paused (e.g. a video switched to inside picture in picture).
        if (${autoPlay ? 'true' : 'false'}) player.playVideo();
      },
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
