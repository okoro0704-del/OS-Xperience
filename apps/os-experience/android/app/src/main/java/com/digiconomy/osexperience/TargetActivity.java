package com.digiconomy.osexperience;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginHandle;
import org.json.JSONException;

/**
 * Direct target launch. Every installed App or Space entry opens here — never in the OS Xperience
 * task — so the target is the visible root: OS Xperience Home is not underneath it, Back leaves to
 * the launcher, and Recents shows one card per target (documentLaunchMode="intoExisting", keyed by
 * the target identity in the intent data). It is the same OS Xperience runtime and storage
 * (one process, one https://localhost origin); only the visible root differs.
 *
 * Not exported: only {@link SpaceEntryActivity} starts it, with an already-normalized, still
 * untrusted launch request that OS Xperience validates.
 */
public class TargetActivity extends MainActivity {
  static final String EXTRA_LAUNCH = "com.digiconomy.osexperience.extra.TARGET_LAUNCH";

  private final Object launchLock = new Object();
  private JSObject pendingLaunch;
  /** BridgeActivity.onCreate replays the creating intent through onNewIntent; only later intents are new taps. */
  private boolean created = false;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    // Also on restore after process death: the WebView restarts empty and must re-enter the same target, never Home.
    holdLaunch(getIntent());
    super.onCreate(savedInstanceState);
    created = true;
  }

  @Override
  protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    if (!created) return;
    setIntent(intent);
    holdLaunch(intent);
    PluginHandle handle = getBridge() != null ? getBridge().getPlugin("SpaceHomeEntry") : null;
    if (handle != null && handle.getInstance() instanceof SpaceHomeEntryPlugin) {
      ((SpaceHomeEntryPlugin) handle.getInstance()).launchArrived();
    }
  }

  private void holdLaunch(Intent intent) {
    JSObject launch = null;
    String raw = intent != null ? intent.getStringExtra(EXTRA_LAUNCH) : null;
    if (raw != null) {
      try {
        launch = new JSObject(raw);
      } catch (JSONException malformed) {
        launch = new JSObject();
      }
    }
    synchronized (launchLock) {
      pendingLaunch = launch;
    }
  }

  /**
   * The launch this task was opened (or last re-opened) with. Not consumed: a WebView reload in this
   * task must re-enter the same target, never fall back to OS Xperience Home.
   */
  JSObject currentLaunch() {
    synchronized (launchLock) {
      return pendingLaunch;
    }
  }
}
