package com.allvideoplayer

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.graphics.Color
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.facebook.react.bridge.Arguments
import com.facebook.react.uimanager.ThemedReactContext

@SuppressLint("SetJavaScriptEnabled", "ViewConstructor")
class AVPWebView(private val reactContext: ThemedReactContext) : WebView(reactContext) {

  var html: String? = null
  var baseUrl: String? = null
  private var loaded: Pair<String, String?>? = null

  init {
    setBackgroundColor(Color.BLACK)
    isVerticalScrollBarEnabled = false
    isHorizontalScrollBarEnabled = false
    overScrollMode = OVER_SCROLL_NEVER

    settings.javaScriptEnabled = true
    settings.domStorageEnabled = true
    settings.mediaPlaybackRequiresUserGesture = false
    CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)

    addJavascriptInterface(Bridge(), "AVPBridge")

    // YouTube's own on-screen controls and branding live in its cross-origin iframe, out of the
    // page's reach; this styles them away inside the iframe.
    if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
      WebViewCompat.addDocumentStartJavaScript(this, HIDE_YOUTUBE_UI, setOf("https://www.youtube.com"))
    }

    webViewClient = object : WebViewClient() {
      // The page itself never navigates; YouTube's iframe (not main frame) loads freely.
      override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        if (!request.isForMainFrame) return false
        val url = request.url.toString()
        val base = baseUrl
        return !(url == "about:blank" || (base != null && url.startsWith(base)))
      }

      override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
        if (request.isForMainFrame) {
          emit(reactContext, EVENT_LOAD_ERROR, Arguments.createMap().apply {
            putString("description", error.description?.toString() ?: "")
          })
        }
      }
    }

    webChromeClient = object : WebChromeClient() {
      // Hides the grey play button Android draws over videos without a poster.
      override fun getDefaultVideoPoster(): Bitmap = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888)
    }
  }

  fun loadIfChanged() {
    val page = html ?: return
    val next = page to baseUrl
    if (next == loaded) return
    loaded = next
    loadDataWithBaseURL(baseUrl, page, "text/html", "utf-8", null)
  }

  private inner class Bridge {
    @JavascriptInterface
    fun postMessage(data: String) {
      post { emit(reactContext, EVENT_MESSAGE, Arguments.createMap().apply { putString("data", data) }) }
    }
  }

  companion object {
    // Hides YouTube's own playback controls in its iframe, and its branding (title bar, logo,
    // watermark, "More videos", end screen) when the page asks for it.
    private val HIDE_YOUTUBE_UI = """
      (function () {
        var css = '.ytwPlayerMiddleControlsHost,.ytwPlayerBottomControlsHost,.ytPlayerProgressBarHost,.player-controls-background,.ytwPlayerSeekOverlayHost,.ytmCuedOverlayPlayButton,.ytp-large-play-button,.ytp-bezel,.ytp-spinner,.ytp-chrome-bottom,.ytp-gradient-bottom{display:none!important}';
        // The page marks the iframe's URL when hideYouTubeBranding is on.
        if (/[?&]avp_hide_branding=1(&|$)/.test(location.search)) css += '.ytwPlayerTopControlsHost,.ytwPlayerFullscreenControlsHost,.ytmCuedOverlayHost,.ytp-chrome-top,.ytp-gradient-top,.ytp-title,.ytp-watermark,.ytp-youtube-button,.ytp-pause-overlay,.html5-endscreen,.ytp-endscreen-content,.ytp-ce-element,.ytp-cards-teaser,.iv-branding{display:none!important}';
        var add = function () {
          if (document.getElementById('avp-hide-youtube-ui')) return;
          var style = document.createElement('style');
          style.id = 'avp-hide-youtube-ui';
          style.textContent = css;
          (document.head || document.documentElement).appendChild(style);
        };
        add();
        document.addEventListener('DOMContentLoaded', add);
        // Captions on/off from our page ({ avpCaptions: boolean }): YouTube's own captions
        // setting doesn't reliably turn them off in its mobile player, so they're hidden here.
        window.addEventListener('message', function (e) {
          if (!e.data || typeof e.data.avpCaptions !== 'boolean') return;
          var hide = document.getElementById('avp-hide-captions');
          if (!e.data.avpCaptions && !hide) {
            hide = document.createElement('style');
            hide.id = 'avp-hide-captions';
            hide.textContent = '.ytp-caption-window-container,.caption-window{display:none!important}';
            (document.head || document.documentElement).appendChild(hide);
          } else if (e.data.avpCaptions && hide) {
            hide.remove();
          }
        });
      })();
    """

    const val EVENT_MESSAGE = "topMessage"
    const val EVENT_LOAD_ERROR = "topLoadError"
  }
}
