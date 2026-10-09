package com.allvideoplayer

import android.view.View
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.events.Event

internal class AVPEvent(surfaceId: Int, viewId: Int, private val name: String, private val payload: WritableMap) :
  Event<AVPEvent>(surfaceId, viewId) {
  override fun getEventName() = name
  override fun getEventData(): WritableMap = payload
}

internal fun View.emit(context: ReactContext, name: String, payload: WritableMap) {
  UIManagerHelper.getEventDispatcherForReactTag(context, id)
    ?.dispatchEvent(AVPEvent(UIManagerHelper.getSurfaceId(this), id, name, payload))
}
