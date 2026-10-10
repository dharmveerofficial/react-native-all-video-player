package com.allvideoplayer

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider
import com.facebook.react.uimanager.ViewManager

class AllVideoPlayerPackage : BaseReactPackage() {

  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? = when (name) {
    AVPOrientationModule.NAME -> AVPOrientationModule(reactContext)
    AVPPictureInPictureModule.NAME -> AVPPictureInPictureModule(reactContext)
    else -> null
  }

  override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
    listOf(AVPOrientationModule.NAME, AVPPictureInPictureModule.NAME).associateWith { name ->
      ReactModuleInfo(
        name = name,
        className = name,
        canOverrideExistingModule = false,
        needsEagerInit = false,
        isCxxModule = false,
        isTurboModule = true
      )
    }
  }

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    listOf(AVPWebViewManager(), AVPVideoViewManager())
}
