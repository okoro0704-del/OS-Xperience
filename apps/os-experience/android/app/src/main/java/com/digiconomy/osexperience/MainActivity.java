package com.digiconomy.osexperience;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.util.Log;
import android.view.MotionEvent;
import android.view.View;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

/**
 * OS Experience Android host:
 * - Edge-to-edge + real WindowInsets → CSS --ox-safe-* (single inset source of truth)
 * - Two-finger horizontal swipe → ox-experience-escape → exitExperienceToHome()
 */
public class MainActivity extends BridgeActivity {
  private static final String TAG = "OxHost";
  private static final float MIN_TRAVEL_DP = 56f;
  private static final float MAX_VERTICAL_RATIO = 0.6f;
  private static final float MAX_PINCH_CHANGE = 0.22f;
  private static final float MIN_DIRECTION_AGREEMENT = 0.55f;
  private static final long MAX_DURATION_MS = 900L;

  private final float[] startX = new float[2];
  private final float[] startY = new float[2];
  private long gestureStartMs = 0L;
  private boolean tracking = false;
  private boolean fired = false;
  private int pointerA = -1;
  private int pointerB = -1;
  private boolean insetsWired = false;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
      getWindow().setStatusBarColor(Color.TRANSPARENT);
      getWindow().setNavigationBarColor(Color.TRANSPARENT);
    }
    WindowInsetsControllerCompat controller =
      WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
    if (controller != null) {
      controller.setAppearanceLightStatusBars(false);
      controller.setAppearanceLightNavigationBars(false);
    }
  }

  @Override
  public void onStart() {
    super.onStart();
    wireSystemInsets();
  }

  @Override
  public void onResume() {
    super.onResume();
    wireSystemInsets();
    pushInsetsToWeb();
  }

  private void wireSystemInsets() {
    if (insetsWired) return;
    final WebView webView = bridgeWebView();
    if (webView == null) return;
    insetsWired = true;
    ViewCompat.setOnApplyWindowInsetsListener(webView, (v, insets) -> {
      Insets bars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
      );
      applyInsetsPx(bars.top, bars.bottom, bars.left, bars.right);
      // Do not consume — WebView/keyboard still need inset dispatch.
      return insets;
    });
    ViewCompat.requestApplyInsets(webView);
  }

  private void pushInsetsToWeb() {
    final WebView webView = bridgeWebView();
    if (webView == null) return;
    ViewCompat.requestApplyInsets(webView);
  }

  private void applyInsetsPx(int top, int bottom, int left, int right) {
    final WebView webView = bridgeWebView();
    if (webView == null) return;
    float d = getResources().getDisplayMetrics().density;
    if (d <= 0f) d = 1f;
    final float topCss = top / d;
    final float bottomCss = bottom / d;
    final float leftCss = left / d;
    final float rightCss = right / d;
    if (BuildConfig.DEBUG) {
      Log.d(TAG, "insets css px top=" + topCss + " bottom=" + bottomCss);
    }
    final String js =
      "(function(){"
        + "var r=document.documentElement;"
        + "r.style.setProperty('--ox-safe-top','" + topCss + "px');"
        + "r.style.setProperty('--ox-safe-bottom','" + bottomCss + "px');"
        + "r.style.setProperty('--ox-safe-left','" + leftCss + "px');"
        + "r.style.setProperty('--ox-safe-right','" + rightCss + "px');"
        + "r.dataset.oxInsets='native';"
        + (BuildConfig.DEBUG ? "r.dataset.oxDebug='1';" : "")
        + "window.dispatchEvent(new CustomEvent('ox-system-insets',{detail:{top:" + topCss
        + ",bottom:" + bottomCss + ",left:" + leftCss + ",right:" + rightCss + "}}));"
        + "})();";
    webView.post(() -> webView.evaluateJavascript(js, null));
  }

  private WebView bridgeWebView() {
    try {
      return getBridge() != null ? getBridge().getWebView() : null;
    } catch (Exception ignored) {
      return null;
    }
  }

  @Override
  public boolean dispatchTouchEvent(MotionEvent event) {
    final int action = event.getActionMasked();
    switch (action) {
      case MotionEvent.ACTION_DOWN:
        resetGesture();
        debugTouch("DOWN", event);
        break;
      case MotionEvent.ACTION_POINTER_DOWN:
        debugTouch("POINTER_DOWN", event);
        if (event.getPointerCount() == 2) {
          pointerA = event.getPointerId(0);
          pointerB = event.getPointerId(1);
          int i0 = event.findPointerIndex(pointerA);
          int i1 = event.findPointerIndex(pointerB);
          if (i0 >= 0 && i1 >= 0) {
            startX[0] = event.getX(i0);
            startY[0] = event.getY(i0);
            startX[1] = event.getX(i1);
            startY[1] = event.getY(i1);
            gestureStartMs = SystemClock.uptimeMillis();
            tracking = true;
            fired = false;
            debugClass("TRACK_START");
          }
        } else if (event.getPointerCount() > 2) {
          resetGesture();
          debugClass("CANCEL_3PLUS");
        }
        break;
      case MotionEvent.ACTION_MOVE:
        if (tracking && !fired && event.getPointerCount() == 2) {
          int i0 = event.findPointerIndex(pointerA);
          int i1 = event.findPointerIndex(pointerB);
          if (i0 >= 0 && i1 >= 0) {
            int verdict = classify(
              startX[0], startY[0], startX[1], startY[1],
              event.getX(i0), event.getY(i0), event.getX(i1), event.getY(i1),
              SystemClock.uptimeMillis() - gestureStartMs
            );
            if (Verdict.ESCAPE == verdict) {
              fired = true;
              debugClass("TWO_FINGER_HORIZONTAL_SWIPE");
              emitEscapeToBridge();
              resetGesture();
              return true;
            }
            if (Verdict.CANCEL == verdict) {
              debugClass("CANCEL");
              resetGesture();
            }
          }
        }
        break;
      case MotionEvent.ACTION_POINTER_UP:
      case MotionEvent.ACTION_UP:
      case MotionEvent.ACTION_CANCEL:
        debugTouch(action == MotionEvent.ACTION_CANCEL ? "CANCEL" : "UP", event);
        resetGesture();
        break;
      default:
        break;
    }
    return super.dispatchTouchEvent(event);
  }

  private void debugTouch(String phase, MotionEvent event) {
    if (!BuildConfig.DEBUG) return;
    Log.d(TAG, phase + " count=" + event.getPointerCount());
    emitDebugJs(phase, event.getPointerCount(), 0, 0);
  }

  private void debugClass(String label) {
    if (!BuildConfig.DEBUG) return;
    Log.d(TAG, "class=" + label);
    emitDebugJs(label, 2, 0, 0);
  }

  private void emitDebugJs(String phase, int count, float dx, float dy) {
    final WebView webView = bridgeWebView();
    if (webView == null) return;
    final String js =
      "window.__oxGestureDebug&&window.__oxGestureDebug("
        + JSONObjectQuote(phase) + "," + count + "," + dx + "," + dy + ");";
    webView.post(() -> webView.evaluateJavascript(js, null));
  }

  private static String JSONObjectQuote(String value) {
    return "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
  }

  private void resetGesture() {
    tracking = false;
    fired = false;
    pointerA = -1;
    pointerB = -1;
    gestureStartMs = 0L;
  }

  private float dp(float value) {
    return value * getResources().getDisplayMetrics().density;
  }

  private static final class Verdict {
    static final int PENDING = 0;
    static final int ESCAPE = 1;
    static final int CANCEL = 2;
  }

  private int classify(
    float s0x, float s0y, float s1x, float s1y,
    float c0x, float c0y, float c1x, float c1y,
    long elapsedMs
  ) {
    if (elapsedMs > MAX_DURATION_MS) return Verdict.CANCEL;

    float d0x = c0x - s0x;
    float d0y = c0y - s0y;
    float d1x = c1x - s1x;
    float d1y = c1y - s1y;
    float travel0 = (float) Math.hypot(d0x, d0y);
    float travel1 = (float) Math.hypot(d1x, d1y);
    float avgAbsDx = (Math.abs(d0x) + Math.abs(d1x)) / 2f;
    float minTravel = dp(MIN_TRAVEL_DP);

    float sign0 = Math.signum(d0x);
    float sign1 = Math.signum(d1x);
    if (avgAbsDx >= minTravel * 0.35f && sign0 != 0f && sign1 != 0f && sign0 != sign1) {
      return Verdict.CANCEL;
    }

    float startSpan = (float) Math.hypot(s0x - s1x, s0y - s1y);
    if (startSpan < 1f) startSpan = 1f;
    float currentSpan = (float) Math.hypot(c0x - c1x, c0y - c1y);
    float pinchChange = Math.abs(currentSpan - startSpan) / startSpan;
    if (pinchChange > MAX_PINCH_CHANGE && Math.max(travel0, travel1) > minTravel * 0.35f) {
      return Verdict.CANCEL;
    }

    if (avgAbsDx < minTravel * 0.35f) return Verdict.PENDING;

    boolean horiz0 = Math.abs(d0x) >= Math.abs(d0y) / MAX_VERTICAL_RATIO;
    boolean horiz1 = Math.abs(d1x) >= Math.abs(d1y) / MAX_VERTICAL_RATIO;
    if (!horiz0 || !horiz1) {
      return avgAbsDx >= minTravel ? Verdict.CANCEL : Verdict.PENDING;
    }

    if (sign0 == 0f || sign1 == 0f || sign0 != sign1) {
      return avgAbsDx >= minTravel ? Verdict.CANCEL : Verdict.PENDING;
    }

    float n0 = travel0 < 1f ? 1f : travel0;
    float n1 = travel1 < 1f ? 1f : travel1;
    float agreement = (d0x / n0) * (d1x / n1) + (d0y / n0) * (d1y / n1);
    if (agreement < MIN_DIRECTION_AGREEMENT) {
      return avgAbsDx >= minTravel ? Verdict.CANCEL : Verdict.PENDING;
    }

    if (avgAbsDx < minTravel) return Verdict.PENDING;
    return Verdict.ESCAPE;
  }

  private void emitEscapeToBridge() {
    final WebView webView = bridgeWebView();
    if (webView == null) return;
    webView.post(() -> webView.evaluateJavascript(
      "(function(){"
        + "if(window.__oxExperienceActive===false)return;"
        + "window.dispatchEvent(new CustomEvent('ox-experience-escape',{detail:{source:'android-host'}}));"
        + "})();",
      null
    ));
  }
}
