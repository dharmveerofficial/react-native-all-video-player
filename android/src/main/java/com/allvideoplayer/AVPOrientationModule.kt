package com.allvideoplayer

import android.content.pm.ActivityInfo
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.UiThreadUtil

class AVPOrientationModule(reactContext: ReactApplicationContext) : NativeAVPOrientationSpec(reactContext) {

  // The activity's own requested orientation, put back by restore().
  private var saved: Int? = null

  override fun getName() = NAME

  override fun lockLandscape() {
    UiThreadUtil.runOnUiThread {
      val activity = reactApplicationContext.currentActivity ?: return@runOnUiThread
      if (saved == null) saved = activity.requestedOrientation
      activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
    }
  }

  override fun restore() {
    UiThreadUtil.runOnUiThread {
      val previous = saved ?: return@runOnUiThread
      saved = null
      reactApplicationContext.currentActivity?.requestedOrientation = previous
    }
  }

  companion object {
    const val NAME = "AVPOrientation"
  }
}
