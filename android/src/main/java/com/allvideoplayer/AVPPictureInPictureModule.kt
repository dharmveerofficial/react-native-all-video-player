package com.allvideoplayer

import android.app.Activity
import android.app.PendingIntent
import android.app.PictureInPictureParams
import android.app.RemoteAction
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.drawable.Icon
import android.os.Build
import android.util.Rational
import androidx.core.app.OnPictureInPictureModeChangedProvider
import androidx.core.app.OnUserLeaveHintProvider
import androidx.core.app.PictureInPictureModeChangedInfo
import androidx.core.content.ContextCompat
import androidx.core.util.Consumer
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.modules.core.DeviceEventManagerModule

class AVPPictureInPictureModule(reactContext: ReactApplicationContext) :
  NativeAVPPictureInPictureSpec(reactContext) {

  private var watched: Activity? = null
  private var autoEnter = false
  private var aspect = 16.0 to 9.0

  // The window's buttons: previous/next for a playlist, otherwise skip back/forward.
  private var playing = false
  private var playlist = false
  private var hasPrevious = false
  private var hasNext = false

  // Android 8-11 have no setAutoEnterEnabled: enter when the user leaves the app (Home, Recents).
  private val leaveHint = Runnable {
    val activity = watched ?: return@Runnable
    // onPause comes before Android reports picture in picture; this tells the video views
    // not to pause on the way in.
    leavingForPictureInPicture = autoEnter
    if (!autoEnter || Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) return@Runnable
    try {
      activity.enterPictureInPictureMode(params())
    } catch (_: IllegalStateException) {
    }
  }

  // Leaving picture in picture while the activity is only CREATED means the user closed the
  // window (rather than expanding it back into the app).
  private val listener = Consumer<PictureInPictureModeChangedInfo> { info ->
    val activity = watched
    val dismissed = !info.isInPictureInPictureMode &&
      (activity as? LifecycleOwner)?.lifecycle?.currentState == Lifecycle.State.CREATED
    // The activity is paused in picture in picture, and React Native stops delivering view
    // events and commands while paused. Resume it for the window; pause it again if the user
    // closes the window (expanding back resumes it through the activity anyway).
    if (info.isInPictureInPictureMode) reactApplicationContext.onHostResume(activity)
    else if (dismissed) reactApplicationContext.onHostPause()
    emit(EVENT, Arguments.createMap().apply {
      putBoolean("active", info.isInPictureInPictureMode)
      putBoolean("dismissed", dismissed)
    })
  }

  // Taps on the window's buttons arrive as broadcasts from their PendingIntents.
  private val actionReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      val action = intent.getStringExtra(EXTRA_ACTION) ?: return
      emit(ACTION_EVENT, Arguments.createMap().apply { putString("action", action) })
    }
  }
  private var receiverRegistered = false

  override fun getName() = NAME

  override fun isSupported(): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false
    val activity = reactApplicationContext.currentActivity ?: return false
    if (!activity.packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)) return false
    return declaresPictureInPicture(activity)
  }

  override fun enter(width: Double, height: Double): Boolean {
    if (!isSupported()) return false
    val activity = reactApplicationContext.currentActivity ?: return false
    aspect = width to height
    watch(activity)
    UiThreadUtil.runOnUiThread {
      try {
        activity.enterPictureInPictureMode(params())
      } catch (_: IllegalStateException) {
      }
    }
    return true
  }

  override fun setAutoEnter(enabled: Boolean, width: Double, height: Double) {
    if (!isSupported()) return
    autoEnter = enabled
    aspect = width to height
    UiThreadUtil.runOnUiThread {
      val activity = reactApplicationContext.currentActivity ?: return@runOnUiThread
      watch(activity)
      apply(activity)
    }
  }

  override fun setActions(playing: Boolean, playlist: Boolean, hasPrevious: Boolean, hasNext: Boolean) {
    if (!isSupported()) return
    this.playing = playing
    this.playlist = playlist
    this.hasPrevious = hasPrevious
    this.hasNext = hasNext
    UiThreadUtil.runOnUiThread {
      val activity = reactApplicationContext.currentActivity ?: return@runOnUiThread
      watch(activity)
      apply(activity)
    }
  }

  override fun addListener(eventName: String) = Unit

  override fun removeListeners(count: Double) = Unit

  override fun invalidate() {
    UiThreadUtil.runOnUiThread {
      unwatch()
      if (receiverRegistered) {
        try {
          reactApplicationContext.unregisterReceiver(actionReceiver)
        } catch (_: IllegalArgumentException) {
        }
        receiverRegistered = false
      }
    }
    super.invalidate()
  }

  // Pushes the current params (ratio, buttons, auto-enter) to the activity, also mid-PiP.
  private fun apply(activity: Activity) {
    try {
      activity.setPictureInPictureParams(params())
    } catch (_: IllegalStateException) {
    }
  }

  private fun watch(activity: Activity) {
    if (!receiverRegistered) {
      ContextCompat.registerReceiver(
        reactApplicationContext,
        actionReceiver,
        IntentFilter(BROADCAST),
        ContextCompat.RECEIVER_NOT_EXPORTED,
      )
      receiverRegistered = true
    }
    if (watched === activity) return
    UiThreadUtil.runOnUiThread {
      unwatch()
      (activity as? OnPictureInPictureModeChangedProvider)?.addOnPictureInPictureModeChangedListener(listener)
      (activity as? OnUserLeaveHintProvider)?.addOnUserLeaveHintListener(leaveHint)
      watched = activity
    }
  }

  private fun unwatch() {
    (watched as? OnPictureInPictureModeChangedProvider)?.removeOnPictureInPictureModeChangedListener(listener)
    (watched as? OnUserLeaveHintProvider)?.removeOnUserLeaveHintListener(leaveHint)
    watched = null
  }

  private fun params(): PictureInPictureParams {
    val builder = PictureInPictureParams.Builder()
      .setAspectRatio(ratio(aspect.first, aspect.second))
      .setActions(actions())
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      builder.setAutoEnterEnabled(autoEnter).setSeamlessResizeEnabled(true)
    }
    return builder.build()
  }

  private fun actions(): List<RemoteAction> {
    val back = if (playlist) {
      action("previous", android.R.drawable.ic_media_previous, "Previous video", hasPrevious)
    } else {
      action("back", android.R.drawable.ic_media_rew, "Back", true)
    }
    val toggle = if (playing) {
      action("pause", android.R.drawable.ic_media_pause, "Pause", true)
    } else {
      action("play", android.R.drawable.ic_media_play, "Play", true)
    }
    val forward = if (playlist) {
      action("next", android.R.drawable.ic_media_next, "Next video", hasNext)
    } else {
      action("forward", android.R.drawable.ic_media_ff, "Forward", true)
    }
    return listOf(back, toggle, forward)
  }

  private fun action(name: String, icon: Int, title: String, enabled: Boolean): RemoteAction {
    val context = reactApplicationContext
    val intent = Intent(BROADCAST).setPackage(context.packageName).putExtra(EXTRA_ACTION, name)
    val pending = PendingIntent.getBroadcast(
      context,
      name.hashCode(),
      intent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    return RemoteAction(Icon.createWithResource(context, icon), title, title, pending).apply { isEnabled = enabled }
  }

  private fun emit(event: String, payload: com.facebook.react.bridge.WritableMap) {
    reactApplicationContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(event, payload)
  }

  companion object {
    /** The user left the app with auto-enter armed; cleared when the app resumes. */
    @Volatile
    @JvmStatic
    var leavingForPictureInPicture = false

    const val NAME = "AVPPictureInPicture"
    const val EVENT = "AVPPictureInPictureChange"
    const val ACTION_EVENT = "AVPPictureInPictureAction"
    private const val BROADCAST = "com.allvideoplayer.PIP_ACTION"
    private const val EXTRA_ACTION = "action"

    // Android only accepts ratios between 1:2.39 and 2.39:1.
    private fun ratio(width: Double, height: Double): Rational {
      val w = if (width > 0) width else 16.0
      val h = if (height > 0) height else 9.0
      val clamped = (w / h).coerceIn(1 / 2.39 + 0.001, 2.39 - 0.001)
      return Rational((clamped * 1000).toInt(), 1000)
    }

    private fun declaresPictureInPicture(activity: Activity): Boolean = try {
      // ActivityInfo.FLAG_SUPPORTS_PICTURE_IN_PICTURE (hidden): set by android:supportsPictureInPicture.
      val info = activity.packageManager.getActivityInfo(activity.componentName, 0)
      info.flags and 0x400000 != 0
    } catch (e: Exception) {
      false
    }
  }
}
