package com.allvideoplayer

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioManager
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * The system media session, so headphone, earphone and Bluetooth buttons control the player
 * that's playing (single press play/pause, double press next, triple press previous). Presses
 * go to JS as 'AVPMediaCommand' events. Unplugging headphones pauses, as other players do.
 */
class AVPMediaSessionModule(reactContext: ReactApplicationContext) : NativeAVPMediaSessionSpec(reactContext) {

  private var session: MediaSession? = null
  private var noisyRegistered = false

  private val noisyReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      if (intent.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) emit("pause")
    }
  }

  override fun getName() = NAME

  override fun update(playing: Boolean, position: Double, duration: Double, hasPrevious: Boolean, hasNext: Boolean) {
    UiThreadUtil.runOnUiThread {
      val current = session ?: createSession().also { session = it }
      var actions = PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or
        PlaybackState.ACTION_PLAY_PAUSE or PlaybackState.ACTION_SEEK_TO or PlaybackState.ACTION_STOP
      if (hasNext) actions = actions or PlaybackState.ACTION_SKIP_TO_NEXT
      if (hasPrevious) actions = actions or PlaybackState.ACTION_SKIP_TO_PREVIOUS
      current.setPlaybackState(
        PlaybackState.Builder()
          .setActions(actions)
          .setState(
            if (playing) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED,
            (position * 1000).toLong(),
            if (playing) 1f else 0f,
          )
          .build()
      )
      current.setMetadata(
        MediaMetadata.Builder().putLong(MediaMetadata.METADATA_KEY_DURATION, (duration * 1000).toLong()).build()
      )
      current.isActive = true
      setNoisyReceiver(playing)
    }
  }

  override fun release() {
    UiThreadUtil.runOnUiThread { releaseSession() }
  }

  override fun invalidate() {
    UiThreadUtil.runOnUiThread { releaseSession() }
    super.invalidate()
  }

  private fun createSession() = MediaSession(reactApplicationContext, NAME).apply {
    setCallback(object : MediaSession.Callback() {
      override fun onPlay() = emit("play")
      override fun onPause() = emit("pause")
      override fun onStop() = emit("pause")
      override fun onSkipToNext() = emit("next")
      override fun onSkipToPrevious() = emit("previous")
      override fun onSeekTo(pos: Long) = emit("seek", pos / 1000.0)
    })
  }

  private fun releaseSession() {
    setNoisyReceiver(false)
    session?.release()
    session = null
  }

  // Listens for headphones being unplugged (or a Bluetooth headset disconnecting) while playing.
  private fun setNoisyReceiver(on: Boolean) {
    if (on == noisyRegistered) return
    if (on) {
      val filter = IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        reactApplicationContext.registerReceiver(noisyReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
      } else {
        reactApplicationContext.registerReceiver(noisyReceiver, filter)
      }
    } else {
      try {
        reactApplicationContext.unregisterReceiver(noisyReceiver)
      } catch (_: IllegalArgumentException) {
      }
    }
    noisyRegistered = on
  }

  private fun emit(command: String, position: Double? = null) {
    val event = Arguments.createMap().apply {
      putString("command", command)
      if (position != null) putDouble("position", position)
    }
    reactApplicationContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(EVENT, event)
  }

  companion object {
    const val NAME = "AVPMediaSession"
    const val EVENT = "AVPMediaCommand"
  }
}
