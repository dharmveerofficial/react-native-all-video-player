package com.allvideoplayer

import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewManagerDelegate
import com.facebook.react.viewmanagers.AVPWebViewManagerDelegate
import com.facebook.react.viewmanagers.AVPWebViewManagerInterface

@ReactModule(name = AVPWebViewManager.NAME)
class AVPWebViewManager : SimpleViewManager<AVPWebView>(), AVPWebViewManagerInterface<AVPWebView> {

  private val delegate = AVPWebViewManagerDelegate(this)

  override fun getDelegate(): ViewManagerDelegate<AVPWebView> = delegate

  override fun getName() = NAME

  override fun createViewInstance(context: ThemedReactContext) = AVPWebView(context)

  override fun setHtml(view: AVPWebView, value: String?) {
    view.html = value
  }

  override fun setBaseUrl(view: AVPWebView, value: String?) {
    view.baseUrl = value
  }

  override fun onAfterUpdateTransaction(view: AVPWebView) {
    super.onAfterUpdateTransaction(view)
    view.loadIfChanged()
  }

  override fun injectJavaScript(view: AVPWebView, script: String) {
    view.evaluateJavascript(script, null)
  }

  override fun onDropViewInstance(view: AVPWebView) {
    super.onDropViewInstance(view)
    view.destroy()
  }

  override fun getExportedCustomDirectEventTypeConstants(): Map<String, Any> = mapOf(
    AVPWebView.EVENT_MESSAGE to mapOf("registrationName" to "onMessage"),
    AVPWebView.EVENT_LOAD_ERROR to mapOf("registrationName" to "onLoadError"),
  )

  companion object {
    const val NAME = "AVPWebView"
  }
}
