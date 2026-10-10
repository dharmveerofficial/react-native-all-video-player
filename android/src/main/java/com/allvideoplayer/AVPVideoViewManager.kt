package com.allvideoplayer

import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewManagerDelegate
import com.facebook.react.viewmanagers.AVPVideoViewManagerDelegate
import com.facebook.react.viewmanagers.AVPVideoViewManagerInterface

@ReactModule(name = AVPVideoViewManager.NAME)
class AVPVideoViewManager : SimpleViewManager<AVPVideoView>(), AVPVideoViewManagerInterface<AVPVideoView> {

  private val delegate = AVPVideoViewManagerDelegate(this)

  override fun getDelegate(): ViewManagerDelegate<AVPVideoView> = delegate

  override fun getName() = NAME

  override fun createViewInstance(context: ThemedReactContext) = AVPVideoView(context)

  override fun setSource(view: AVPVideoView, value: String?) = view.setSource(value)

  override fun setGrabPoster(view: AVPVideoView, value: Boolean) = view.setGrabPoster(value)

  override fun play(view: AVPVideoView) = view.play()

  override fun pause(view: AVPVideoView) = view.pause()

  override fun seekTo(view: AVPVideoView, seconds: Double) = view.seekTo(seconds)

  override fun setRate(view: AVPVideoView, rate: Float) = view.setRate(rate)

  override fun setMuted(view: AVPVideoView, muted: Boolean) = view.setMuted(muted)

  // Picture in picture is activity-wide on Android (AVPPictureInPictureModule); these are iOS-only.
  override fun setPictureInPicture(view: AVPVideoView, value: Boolean) = Unit

  override fun setAutoEnterPictureInPicture(view: AVPVideoView, value: Boolean) = Unit

  override fun startPictureInPicture(view: AVPVideoView) = Unit

  override fun onDropViewInstance(view: AVPVideoView) {
    super.onDropViewInstance(view)
    view.destroy()
  }

  override fun getExportedCustomDirectEventTypeConstants(): Map<String, Any> = mapOf(
    AVPVideoView.EVENT_READY to mapOf("registrationName" to "onVideoReady"),
    AVPVideoView.EVENT_STATE to mapOf("registrationName" to "onVideoState"),
    AVPVideoView.EVENT_PROGRESS to mapOf("registrationName" to "onVideoProgress"),
    AVPVideoView.EVENT_ERROR to mapOf("registrationName" to "onVideoError"),
    AVPVideoView.EVENT_POSTER to mapOf("registrationName" to "onVideoPoster"),
  )

  companion object {
    const val NAME = "AVPVideoView"
  }
}
