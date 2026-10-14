export interface YouTubeHtmlOptions {
  /** Must already be validated (isValidVideoId): it is inlined into the page. */
  videoId: string;
  origin: string;
  startSeconds: number;
  /**
   * Hide YouTube's title bar, logo, watermark, "More videos" and end screen. The native WebView
   * does the hiding, with CSS it injects into YouTube's iframe; the page only marks the iframe.
   */
  hideBranding: boolean;
  /** Also cover pauses mid-video, not just the start and end. */
  thumbnailOnPause: boolean;
  /** Cover image over the video before the first play and at the end; passing one turns it on. */
  thumbnail?: string;
  /** Start playing as soon as the player is ready, from inside the page. */
  autoPlay?: boolean;
  /** Whether captions start on (when the video has them). Default true. */
  captions?: boolean;
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

/** Percent-encodes what could break out of a CSS url("...") inside a <style>. */
export function cssUrl(url: string): string {
  return url.replace(/["'()\\<>\s]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
}

export function youtubeHtml(options: YouTubeHtmlOptions): string {
  const { videoId, origin, startSeconds, hideBranding, thumbnailOnPause, thumbnail, autoPlay = false, captions = true } = options;
  const start = Math.max(0, Math.floor(startSeconds));
  const onPause = thumbnailOnPause ? 'true' : 'false';
  const coverOn = !!thumbnail;
  const image = thumbnail ? cssUrl(thumbnail) : '';

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
// Sizes in px from the window: Android WebView can keep html/body at 0px tall
// when the page loads before the view is laid out, collapsing 100% heights.
function layout() {
  var w = window.innerWidth, h = window.innerHeight;
  document.getElementById('frame').textContent = '#player,#cover,#shield{width:' + w + 'px;height:' + h + 'px}';
}
layout();
window.addEventListener('resize', layout);
function send(m) { window.AVPBridge.postMessage(JSON.stringify(m)); }
// Thumbnail over the start and end, and over pauses when onPause.
// With onPause, buffering keeps the current look so seeking while paused
// doesn't flash the video.
function updateCover(state) {
  if (state === 1) hasPlayed = true;
  if (state === 3 && ${onPause}) return;
  var show = ${coverOn} && (state === 0 || (state === 2 && ${onPause}) || (!hasPlayed && state !== 1));
  cover.className = show ? '' : 'hidden';
}
// Captions: YouTube loads them (cc_load_policy) and says whether the video has any; whether they
// show is the viewer's choice, applied by the native WebView's script inside YouTube's iframe,
// since YouTube's own captions setting doesn't reliably turn them off in its mobile player.
var captionsWanted = ${captions ? 'true' : 'false'}, captionsAvailable = false;
function postCaptions() {
  var frame = document.getElementById('player');
  if (frame && frame.contentWindow) frame.contentWindow.postMessage({ avpCaptions: captionsWanted }, '*');
}
function reportCaptions() {
  var options = (player.getOptions && player.getOptions()) || [];
  if (options.indexOf('captions') >= 0 || options.indexOf('cc') >= 0) captionsAvailable = true;
  postCaptions();
  send({ type: 'captions', available: captionsAvailable, on: captionsAvailable && captionsWanted });
}
function setCaptions(on) {
  captionsWanted = on;
  postCaptions();
  reportCaptions();
}
function onYouTubeIframeAPIReady() {
  player = new YT.Player('player', {
    videoId: '${videoId}',
    width: '100%', height: '100%',
    playerVars: { controls: 0, disablekb: 1, fs: 0, rel: 0, playsinline: 1, iv_load_policy: 3,
                  modestbranding: 1, cc_load_policy: 1, start: ${start}, origin: ${JSON.stringify(origin)},
                  // Read by the native WebView's script inside YouTube's iframe.
                  avp_hide_branding: ${hideBranding ? 1 : 0} },
    events: {
      onReady: function () {
        ready = true;
        send({ type: 'ready', duration: player.getDuration() });
        postCaptions();
        // Started here, not by a command from the app: commands can't arrive while the app is
        // paused (e.g. a video switched to inside picture in picture).
        if (${autoPlay ? 'true' : 'false'}) player.playVideo();
      },
      onStateChange: function (e) { updateCover(e.data); send({ type: 'state', state: e.data }); },
      // YouTube loads its captions module once a video with captions starts; that's when we
      // learn whether there are captions, and whether they're showing.
      onApiChange: reportCaptions,
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
