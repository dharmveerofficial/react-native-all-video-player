package com.allvideoplayer

import android.annotation.SuppressLint
import android.graphics.Color
import android.widget.FrameLayout
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.uimanager.ThemedReactContext

@OptIn(UnstableApi::class)
@SuppressLint("ViewConstructor")
class AVPVideoView(private val reactContext: ThemedReactContext) :
  FrameLayout(reactContext), LifecycleEventListener {

  private val playerView = PlayerView(reactContext).apply {
    useController = false
    resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
    setShutterBackgroundColor(Color.BLACK)
    setBackgroundColor(Color.BLACK)
    layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
  }
  private var player: ExoPlayer? = null
  private var source: String? = null
  private var ready = false
  private var hasPlayed = false
  private var lastState = STATE_UNSTARTED

  private val progressTick = object : Runnable {
    override fun run() {
      emitProgress()
      postDelayed(this, 500)
    }
  }

  // RN doesn't lay out natively added children (the video surface); do it here.
  private val measureAndLayout = Runnable {
    measure(MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY))
    layout(left, top, right, bottom)
  }

  private val listener = object : Player.Listener {
    override fun onPlaybackStateChanged(playbackState: Int) {
      if (playbackState == Player.STATE_READY && !ready) {
        ready = true
        emit(reactContext, EVENT_READY, Arguments.createMap().apply { putDouble("duration", durationSeconds()) })
        removeCallbacks(progressTick)
        post(progressTick)
      }
      updateState()
    }

    override fun onIsPlayingChanged(isPlaying: Boolean) {
      if (isPlaying) hasPlayed = true
      updateState()
    }

    override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) = updateState()

    override fun onPlayerError(error: PlaybackException) {
      emit(reactContext, EVENT_ERROR, Arguments.createMap().apply { putString("message", describe(error)) })
    }
  }

  init {
    setBackgroundColor(Color.BLACK)
    addView(playerView)
    reactContext.addLifecycleEventListener(this)
  }

  override fun requestLayout() {
    super.requestLayout()
    post(measureAndLayout)
  }

  fun setSource(url: String?) {
    if (url == source) return
    source = url
    releasePlayer()
    if (url.isNullOrEmpty()) return
    player = ExoPlayer.Builder(reactContext).build().also {
      it.addListener(listener)
      it.setMediaItem(MediaItem.fromUri(url))
      it.prepare()
      playerView.player = it
    }
  }

  fun play() {
    val p = player ?: return
    if (p.playbackState == Player.STATE_ENDED) p.seekTo(0)
    p.play()
  }

  fun pause() {
    player?.pause()
  }

  fun seekTo(seconds: Double) {
    player?.seekTo((seconds.coerceAtLeast(0.0) * 1000).toLong())
  }

  fun setRate(rate: Float) {
    if (rate > 0) player?.setPlaybackSpeed(rate)
  }

  fun setMuted(muted: Boolean) {
    player?.volume = if (muted) 0f else 1f
  }

  fun destroy() {
    reactContext.removeLifecycleEventListener(this)
    releasePlayer()
  }

  override fun onHostPause() = pause()

  override fun onHostResume() = Unit

  override fun onHostDestroy() = destroy()

  private fun releasePlayer() {
    removeCallbacks(progressTick)
    player?.removeListener(listener)
    player?.release()
    player = null
    playerView.player = null
    ready = false
    hasPlayed = false
    lastState = STATE_UNSTARTED
  }

  private fun updateState() {
    val p = player ?: return
    val state = when (p.playbackState) {
      Player.STATE_ENDED -> STATE_ENDED
      Player.STATE_BUFFERING -> if (p.playWhenReady) STATE_BUFFERING else if (hasPlayed) STATE_PAUSED else STATE_UNSTARTED
      Player.STATE_READY -> if (p.isPlaying) STATE_PLAYING else if (hasPlayed) STATE_PAUSED else STATE_CUED
      else -> STATE_UNSTARTED
    }
    if (state == lastState) return
    lastState = state
    emit(reactContext, EVENT_STATE, Arguments.createMap().apply { putInt("state", state) })
  }

  private fun emitProgress() {
    val p = player ?: return
    emit(reactContext, EVENT_PROGRESS, Arguments.createMap().apply {
      putDouble("currentTime", p.currentPosition / 1000.0)
      putDouble("duration", durationSeconds())
    })
  }

  private fun durationSeconds(): Double {
    val ms = player?.duration ?: C.TIME_UNSET
    return if (ms == C.TIME_UNSET || ms < 0) 0.0 else ms / 1000.0
  }

  private fun describe(error: PlaybackException): String = when (error.errorCode) {
    PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED,
    PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT ->
      "A network error stopped the video from loading"
    PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS,
    PlaybackException.ERROR_CODE_IO_FILE_NOT_FOUND ->
      "The video link is invalid or has expired"
    PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED,
    PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED,
    PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED ->
      "The video format is not supported"
    else -> error.message ?: "The video could not be played"
  }

  companion object {
    const val EVENT_READY = "topVideoReady"
    const val EVENT_STATE = "topVideoState"
    const val EVENT_PROGRESS = "topVideoProgress"
    const val EVENT_ERROR = "topVideoError"

    // Same codes as YouTube's player states, which the JS side uses for both engines.
    private const val STATE_UNSTARTED = -1
    private const val STATE_ENDED = 0
    private const val STATE_PLAYING = 1
    private const val STATE_PAUSED = 2
    private const val STATE_BUFFERING = 3
    private const val STATE_CUED = 5
  }
}
