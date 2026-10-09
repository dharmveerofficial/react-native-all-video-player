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
    const val EVENT_MESSAGE = "topMessage"
    const val EVENT_LOAD_ERROR = "topLoadError"
  }
}
