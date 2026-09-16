package com.digiconomy.osexperience;

import android.os.SystemClock;
import android.view.MotionEvent;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

/**
 * Host-owned ExperienceMode escape:
 * two fingers travelling together horizontally → OS Xperience Home.
 * Does not steal one-finger app swipes or pinch-to-zoom.
 */
public class MainActivity extends BridgeActivity {
  private static final float MIN_TRAVEL_DP = 72f;
  private static final float MAX_VERTICAL_RATIO = 0.55f;
  private static final float MAX_PINCH_CHANGE = 0.2f;
  private static final float MIN_DIRECTION_AGREEMENT = 0.65f;
  private static final long MAX_DURATION_MS = 750L;

  private final float[] startX = new float[2];
  private final float[] startY = new float[2];
  private long gestureStartMs = 0L;
  private boolean tracking = false;
  private boolean fired = false;
  private int pointerA = -1;
  private int pointerB = -1;

  @Override
  public boolean dispatchTouchEvent(MotionEvent event) {
    final int action = event.getActionMasked();
    switch (action) {
      case MotionEvent.ACTION_DOWN:
        resetGesture();
        break;
      case MotionEvent.ACTION_POINTER_DOWN:
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
          }
        } else {
          resetGesture();
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
              emitEscapeToBridge();
              resetGesture();
              return true;
            }
            if (Verdict.CANCEL == verdict) {
              resetGesture();
            }
          }
        }
        break;
      case MotionEvent.ACTION_POINTER_UP:
      case MotionEvent.ACTION_UP:
      case MotionEvent.ACTION_CANCEL:
        resetGesture();
        break;
      default:
        break;
    }
    return super.dispatchTouchEvent(event);
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
    final WebView webView = getBridge() != null ? getBridge().getWebView() : null;
    if (webView == null) return;
    webView.post(() -> webView.evaluateJavascript(
      "window.dispatchEvent(new CustomEvent('ox-experience-escape',{detail:{source:'android-host'}}));",
      null
    ));
  }
}
