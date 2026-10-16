package com.allvideoplayer

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.os.Build
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewGroup
import android.view.WindowInsets
import android.widget.FrameLayout
import com.facebook.react.ReactApplication
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.interfaces.fabric.ReactSurface
import com.facebook.react.modules.core.DeviceEventManagerModule
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * The in-app mini player: runs the 'AVPMiniPlayer' React component as a second surface of the
 * app's own React host, inside a frame laid over the activity's window. Dragging and pinch-to-
 * resize are handled here, in screen coordinates (the frame moves under the finger, so JS touch
 * positions, which are relative to it, can't track it); taps pass through to the React content.
 */
class AVPMiniPlayerModule(reactContext: ReactApplicationContext) : NativeAVPMiniPlayerSpec(reactContext) {

  private var surface: ReactSurface? = null
  private var frame: DragFrame? = null
  private var host: Activity? = null

  override fun getName() = NAME

  override fun isSupported(): Boolean =
    (reactApplicationContext.applicationContext as? ReactApplication)?.reactHost != null

  override fun show(
    x: Double,
    y: Double,
    width: Double,
    height: Double,
    fromX: Double,
    fromY: Double,
    fromWidth: Double,
    fromHeight: Double,
  ): Boolean {
    val activity = reactApplicationContext.currentActivity ?: return false
    val reactHost = (activity.application as? ReactApplication)?.reactHost ?: return false
    UiThreadUtil.runOnUiThread {
      if (surface == null || host !== activity) {
        removeSurface()
        val created = reactHost.createSurface(activity, COMPONENT, null)
        val view = created.view ?: return@runOnUiThread
        val container = DragFrame(activity).apply {
          elevation = dp(12.0).toFloat()
          addView(view, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        }
        (activity.window.decorView as ViewGroup).addView(container, FrameLayout.LayoutParams(dp(width), dp(height)))
        created.start()
        surface = created
        frame = container
        host = activity
      }
      val view = frame ?: return@runOnUiThread
      view.animate().cancel()
      view.expanded = false
      place(x, y, width, height)
      if (fromWidth > 0 && fromHeight > 0) {
        view.animateFrom(dp(fromX).toFloat(), dp(fromY).toFloat(), dp(fromWidth), dp(fromHeight), dp(width), dp(height))
      }
    }
    return true
  }

  override fun hideTo(x: Double, y: Double, width: Double, height: Double) {
    UiThreadUtil.runOnUiThread {
      val view = frame ?: return@runOnUiThread
      view.animateInto(dp(x).toFloat(), dp(y).toFloat(), dp(width), dp(height)) {
        if (frame === view) removeSurface()
      }
    }
  }

  override fun move(x: Double, y: Double, width: Double, height: Double) {
    UiThreadUtil.runOnUiThread { place(x, y, width, height) }
  }

  override fun hide() {
    UiThreadUtil.runOnUiThread { removeSurface() }
  }

  override fun expand() {
    UiThreadUtil.runOnUiThread { frame?.expand() }
  }

  override fun collapse() {
    UiThreadUtil.runOnUiThread { frame?.collapse() }
  }

  override fun topInset(): Double {
    val decor = reactApplicationContext.currentActivity?.window?.decorView ?: return 0.0
    val insets = decor.rootWindowInsets ?: return 0.0
    val top =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) insets.getInsets(WindowInsets.Type.systemBars()).top
      else @Suppress("DEPRECATION") insets.systemWindowInsetTop
    return top / reactApplicationContext.resources.displayMetrics.density.toDouble()
  }

  override fun invalidate() {
    UiThreadUtil.runOnUiThread { removeSurface() }
    super.invalidate()
  }

  private fun place(x: Double, y: Double, width: Double, height: Double) {
    val view = frame ?: return
    view.resize(dp(width), dp(height))
    view.x = dp(x).toFloat()
    view.y = dp(y).toFloat()
  }

  private fun removeSurface() {
    val current = surface
    surface = null
    host = null
    current?.stop()
    frame?.let { (it.parent as? ViewGroup)?.removeView(it) }
    frame = null
  }

  private fun dp(value: Double): Int = (value * reactApplicationContext.resources.displayMetrics.density).roundToInt()

  /** Follows the finger once it moves past the touch slop and resizes with a pinch; on release
   * it snaps to the nearer side, or closes when flung off one. */
  @SuppressLint("ViewConstructor")
  private inner class DragFrame(context: Context) : FrameLayout(context) {
    private val slop = ViewConfiguration.get(context).scaledTouchSlop
    private var downX = 0f
    private var downY = 0f
    private var startX = 0f
    private var startY = 0f
    private var dragging = false
    private var pinched = false
    private var miniBounds: IntArray? = null
    var expanded = false

    private val scaler = ScaleGestureDetector(context, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
      override fun onScale(detector: ScaleGestureDetector): Boolean {
        val parentView = parent as? View ?: return false
        if (width == 0) return false
        val ratio = height.toFloat() / width
        val minW = dp(MIN_WIDTH_DP).toFloat()
        val maxW = maxOf(minW, parentView.width - dp(MARGIN_DP) * 2f)
        val newW = (width * detector.scaleFactor).coerceIn(minW, maxW).roundToInt()
        val newH = (newW * ratio).roundToInt()
        val centerX = x + width / 2f
        val centerY = y + height / 2f
        resize(newW, newH)
        x = centerX - newW / 2f
        y = centerY - newH / 2f
        return true
      }
    })

    fun resize(w: Int, h: Int) {
      val params = layoutParams ?: return
      if (params.width != w || params.height != h) {
        params.width = w
        params.height = h
        layoutParams = params
      }
    }

    /** Starts at the given frame (drawn scaled, so the content doesn't re-lay out every frame)
     * and grows/moves into its own, already set, `width` x `height` frame. */
    fun animateFrom(fromX: Float, fromY: Float, fromW: Int, fromH: Int, w: Int, h: Int) {
      if (w <= 0 || h <= 0) return
      val toX = x
      val toY = y
      pivotX = 0f
      pivotY = 0f
      scaleX = fromW.toFloat() / w
      scaleY = fromH.toFloat() / h
      x = fromX
      y = fromY
      animate().x(toX).y(toY).scaleX(1f).scaleY(1f).setDuration(ANIMATION_MS).start()
    }

    /** Moves/shrinks into the given frame, then runs `done`. */
    fun animateInto(toX: Float, toY: Float, toW: Int, toH: Int, done: () -> Unit) {
      animate().cancel()
      if (width <= 0 || height <= 0) return done()
      pivotX = 0f
      pivotY = 0f
      animate()
        .x(toX)
        .y(toY)
        .scaleX(toW.toFloat() / width)
        .scaleY(toH.toFloat() / height)
        .setDuration(ANIMATION_MS)
        .withEndAction(done)
        .start()
    }

    fun expand() {
      if (expanded) return
      val parentView = parent as? View ?: return
      animate().cancel()
      scaleX = 1f
      scaleY = 1f
      val bounds = intArrayOf(x.roundToInt(), y.roundToInt(), width, height)
      miniBounds = bounds
      expanded = true
      elevation = 0f
      x = 0f
      y = 0f
      resize(parentView.width, parentView.height)
      animateFrom(bounds[0].toFloat(), bounds[1].toFloat(), bounds[2], bounds[3], parentView.width, parentView.height)
    }

    fun collapse() {
      if (!expanded) return
      val parentView = parent as? View ?: return
      animate().cancel()
      expanded = false
      elevation = dp(12.0).toFloat()
      val bounds = miniBounds ?: return
      resize(bounds[2], bounds[3])
      x = bounds[0].toFloat()
      y = bounds[1].toFloat()
      animateFrom(0f, 0f, parentView.width, parentView.height, bounds[2], bounds[3])
    }

    override fun onInterceptTouchEvent(ev: MotionEvent): Boolean {
      if (expanded) return false
      scaler.onTouchEvent(ev)
      when (ev.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          animate().cancel()
          scaleX = 1f
          scaleY = 1f
          downX = ev.rawX
          downY = ev.rawY
          startX = x
          startY = y
          dragging = false
          pinched = false
        }
        MotionEvent.ACTION_POINTER_DOWN -> {
          pinched = true
          dragging = true
        }
        MotionEvent.ACTION_MOVE ->
          if (!dragging && (abs(ev.rawX - downX) > slop || abs(ev.rawY - downY) > slop)) dragging = true
      }
      return dragging
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(ev: MotionEvent): Boolean {
      if (expanded) return false
      scaler.onTouchEvent(ev)
      when (ev.actionMasked) {
        MotionEvent.ACTION_POINTER_DOWN -> pinched = true
        MotionEvent.ACTION_MOVE ->
          // After a pinch, a remaining finger doesn't drag (its start point no longer matches).
          if (!pinched && !scaler.isInProgress) {
            x = startX + ev.rawX - downX
            y = startY + ev.rawY - downY
          }
        MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
          dragging = false
          settle(fling = !pinched)
        }
      }
      return true
    }

    private fun settle(fling: Boolean) {
      val parentView = parent as? View ?: return
      val margin = dp(MARGIN_DP).toFloat()
      if (fling && (x < -width * 0.4f || x > parentView.width - width * 0.6f)) {
        removeSurface()
        reactApplicationContext
          .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit(EVENT_CLOSED, null)
        return
      }
      val toX = if (x + width / 2f < parentView.width / 2f) margin else parentView.width - width - margin
      val maxY = parentView.height - dp(BOTTOM_OFFSET_DP) - height.toFloat()
      val toY = y.coerceIn(margin + dp(TOP_EXTRA_DP), maxOf(margin + dp(TOP_EXTRA_DP), maxY))
      animate().x(toX).y(toY).setDuration(220).start()
    }
  }

  companion object {
    const val NAME = "AVPMiniPlayer"
    const val COMPONENT = "AVPMiniPlayer"
    const val EVENT_CLOSED = "AVPMiniPlayerClosed"
    private const val MARGIN_DP = 12.0
    private const val TOP_EXTRA_DP = 40.0
    private const val BOTTOM_OFFSET_DP = 80.0
    private const val MIN_WIDTH_DP = 160.0
    private const val ANIMATION_MS = 260L
  }
}
