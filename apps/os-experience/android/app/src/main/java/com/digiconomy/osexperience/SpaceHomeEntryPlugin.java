package com.digiconomy.osexperience;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.os.Build;
import android.os.Bundle;
import androidx.core.content.pm.ShortcutInfoCompat;
import androidx.core.content.pm.ShortcutManagerCompat;
import androidx.core.graphics.drawable.IconCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Collections;
import java.util.regex.Pattern;

/**
 * Home entries: Android pinned shortcuts into Spaces (Space Installation V1) and installed Apps
 * hosted by OS Xperience. Platform integration only — it pins, updates, disables and lists
 * launcher entries and hands launch requests to the target's own task. It never decides whether a
 * target is verified, trusted, released or ready: OS Xperience validates every request with the
 * canonical Space and App resolvers.
 */
@CapacitorPlugin(name = "SpaceHomeEntry")
public class SpaceHomeEntryPlugin extends Plugin {
  static final String ACTION_OPEN_SPACE = "com.digiconomy.osexperience.action.OPEN_SPACE";
  static final String EXTRA_SPACE_ID = "ox.space.id";
  static final String ACTION_OPEN_APP = "com.digiconomy.osexperience.action.OPEN_APP";
  static final String EXTRA_APP_ID = "ox.app.id";
  private static final String SHORTCUT_PREFIX = "space:";
  private static final String APP_SHORTCUT_PREFIX = "app:";
  private static final Pattern SPACE_ID = Pattern.compile("^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$");
  private static final Pattern COLOR = Pattern.compile("^#[0-9a-fA-F]{6}$");
  private static final Pattern MONOGRAM = Pattern.compile("^[A-Z0-9]{1,2}$");
  private static final int MAX_LABEL = 64;
  private static final int MAX_RAW_ID = 256;
  private static final int MAX_EXTRA_KEYS = 32;
  private static final int MAX_KEY_LENGTH = 64;
  private static final int ICON_PX = 432;

  /** Called by {@link TargetActivity} when its task is re-opened with a new tap. */
  void launchArrived() {
    notifyListeners("spaceLaunch", new JSObject(), true);
  }

  /** Document identity of a target's task: one Recents card per target. Format-checked, never trusted. */
  static String taskIdentity(JSObject launch) {
    String action = launch.optString("action", "");
    String spaceId = launch.optString("spaceId", "");
    String appId = launch.optString("appId", "");
    if (ACTION_OPEN_SPACE.equals(action) && SPACE_ID.matcher(spaceId).matches()) return SHORTCUT_PREFIX + spaceId;
    if (ACTION_OPEN_APP.equals(action) && SPACE_ID.matcher(appId).matches()) return APP_SHORTCUT_PREFIX + appId;
    return "invalid";
  }

  /** Size-bounded, uninterpreted view of the intent. Validation happens in OS Xperience. */
  static JSObject normalize(Intent intent) {
    JSObject out = new JSObject();
    JSArray keys = new JSArray();
    out.put("action", intent != null ? intent.getAction() : null);
    out.put("hasData", intent != null && intent.getData() != null);
    try {
      Bundle extras = intent != null ? intent.getExtras() : null;
      if (extras != null) {
        int count = 0;
        for (String key : extras.keySet()) {
          if (count++ > MAX_EXTRA_KEYS) break;
          keys.put(key != null && key.length() <= MAX_KEY_LENGTH ? key : "ox.invalid-key");
        }
        String spaceId = extras.getString(EXTRA_SPACE_ID);
        if (spaceId != null && spaceId.length() <= MAX_RAW_ID) out.put("spaceId", spaceId);
        String appId = extras.getString(EXTRA_APP_ID);
        if (appId != null && appId.length() <= MAX_RAW_ID) out.put("appId", appId);
      }
    } catch (RuntimeException unreadable) {
      keys.put("ox.unreadable");
    }
    out.put("extraKeys", keys);
    return out;
  }

  /** The launcher's pin confirmation is another app's window; returning from it does not hide the WebView. */
  @Override
  protected void handleOnResume() {
    super.handleOnResume();
    notifyListeners("homeEntriesChanged", new JSObject());
  }

  /** Only a target's own task carries a launch; the OS Xperience task never does (it always opens Home). */
  @PluginMethod
  public void takeLaunch(PluginCall call) {
    JSObject result = new JSObject();
    Activity activity = getActivity();
    boolean targetTask = activity instanceof TargetActivity;
    if (targetTask) {
      JSObject launch = ((TargetActivity) activity).currentLaunch();
      if (launch != null) result.put("launch", launch);
    }
    result.put("targetTask", targetTask);
    call.resolve(result);
  }

  /** Names a target's task in Recents with its trusted label and monogram. No effect in the OS Xperience task. */
  @PluginMethod
  public void presentTarget(PluginCall call) {
    String label = call.getString("label");
    String monogram = call.getString("monogram");
    String color = call.getString("color");
    if (!presentationValid(label, monogram, color)) {
      call.reject("INVALID_PRESENTATION");
      return;
    }
    Activity activity = getActivity();
    if (activity instanceof TargetActivity) {
      int primary = Color.parseColor(color);
      Bitmap icon = monogramBitmap(monogram, primary);
      activity.runOnUiThread(() -> activity.setTaskDescription(taskDescription(label, icon, primary)));
    }
    call.resolve();
  }

  @SuppressWarnings("deprecation")
  private static ActivityManager.TaskDescription taskDescription(String label, Bitmap icon, int color) {
    return new ActivityManager.TaskDescription(label, icon, color);
  }

  private static boolean isEntryShortcutId(String id) {
    return id.startsWith(SHORTCUT_PREFIX) || id.startsWith(APP_SHORTCUT_PREFIX);
  }

  private boolean pinSupported() {
    return Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && ShortcutManagerCompat.isRequestPinShortcutSupported(getContext());
  }

  @PluginMethod
  public void supported(PluginCall call) {
    JSObject result = new JSObject();
    result.put("supported", pinSupported());
    call.resolve(result);
  }

  /** Enabled Space and App entries Android reports as pinned on a launcher. */
  @PluginMethod
  public void pinned(PluginCall call) {
    JSArray ids = new JSArray();
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      ShortcutManager manager = getContext().getSystemService(ShortcutManager.class);
      if (manager != null) {
        for (ShortcutInfo info : manager.getPinnedShortcuts()) {
          if (isEntryShortcutId(info.getId()) && info.isEnabled()) ids.put(info.getId());
        }
      }
    }
    JSObject result = new JSObject();
    result.put("shortcutIds", ids);
    call.resolve(result);
  }

  @PluginMethod
  public void requestPin(PluginCall call) {
    if (!pinSupported()) {
      call.reject("UNSUPPORTED");
      return;
    }
    ShortcutInfoCompat shortcut = buildShortcut(call);
    if (shortcut == null) return;
    Context context = getContext();
    ShortcutManager manager = context.getSystemService(ShortcutManager.class);
    boolean alreadyPinned = false;
    if (manager != null) {
      for (ShortcutInfo info : manager.getPinnedShortcuts()) {
        if (!info.getId().equals(shortcut.getId())) continue;
        if (info.isEnabled()) {
          alreadyPinned = true;
        } else {
          // Removed earlier but still on a launcher page: re-enabled, then requested again (Android skips the dialog while it stays pinned).
          manager.enableShortcuts(Collections.singletonList(info.getId()));
        }
      }
    }
    JSObject result = new JSObject();
    if (alreadyPinned) {
      // Same Space identity, still live: the existing icon is refreshed, never duplicated.
      ShortcutManagerCompat.updateShortcuts(context, Collections.singletonList(shortcut));
      result.put("requested", true);
      result.put("alreadyPinned", true);
    } else {
      result.put("requested", ShortcutManagerCompat.requestPinShortcut(context, shortcut, null));
      result.put("alreadyPinned", false);
    }
    call.resolve(result);
  }

  @PluginMethod
  public void update(PluginCall call) {
    ShortcutInfoCompat shortcut = buildShortcut(call);
    if (shortcut == null) return;
    ShortcutManagerCompat.updateShortcuts(getContext(), Collections.singletonList(shortcut));
    call.resolve();
  }

  /** Android does not allow apps to unpin icons; a disabled entry stays visible but can no longer launch. */
  @PluginMethod
  public void disable(PluginCall call) {
    String shortcutId = call.getString("shortcutId");
    String prefix = shortcutId == null ? null : shortcutId.startsWith(SHORTCUT_PREFIX) ? SHORTCUT_PREFIX : shortcutId.startsWith(APP_SHORTCUT_PREFIX) ? APP_SHORTCUT_PREFIX : null;
    if (prefix == null || !SPACE_ID.matcher(shortcutId.substring(prefix.length())).matches()) {
      call.reject("INVALID_SHORTCUT");
      return;
    }
    ShortcutManagerCompat.disableShortcuts(getContext(), Collections.singletonList(shortcutId), "Removed in OS Xperience");
    call.resolve();
  }

  /** Format checks only (defence in depth); trust was already decided by OS Xperience. */
  private ShortcutInfoCompat buildShortcut(PluginCall call) {
    if (call.getData().has("appId")) return buildAppShortcut(call);
    String spaceId = call.getString("spaceId");
    String shortcutId = call.getString("shortcutId");
    String label = call.getString("label");
    String monogram = call.getString("monogram");
    String color = call.getString("color");
    if (spaceId == null || !SPACE_ID.matcher(spaceId).matches() || spaceId.contains("..")
        || !(SHORTCUT_PREFIX + spaceId).equals(shortcutId)
        || label == null || label.trim().isEmpty() || label.length() > MAX_LABEL || hasControl(label)
        || monogram == null || !MONOGRAM.matcher(monogram).matches()
        || color == null || !COLOR.matcher(color).matches()) {
      call.reject("INVALID_SHORTCUT");
      return null;
    }
    Context context = getContext();
    Intent intent = new Intent(ACTION_OPEN_SPACE);
    intent.setClass(context, SpaceEntryActivity.class);
    intent.putExtra(EXTRA_SPACE_ID, spaceId);
    return new ShortcutInfoCompat.Builder(context, shortcutId)
        .setShortLabel(label)
        .setLongLabel(label)
        .setIcon(monogramIcon(monogram, Color.parseColor(color)))
        .setIntent(intent)
        .build();
  }

  /** APP entry: same checks and the same trampoline, a different action and the App identity extra. */
  private ShortcutInfoCompat buildAppShortcut(PluginCall call) {
    String appId = call.getString("appId");
    String shortcutId = call.getString("shortcutId");
    String label = call.getString("label");
    String monogram = call.getString("monogram");
    String color = call.getString("color");
    if (call.getData().has("spaceId")
        || appId == null || !SPACE_ID.matcher(appId).matches() || appId.contains("..")
        || !(APP_SHORTCUT_PREFIX + appId).equals(shortcutId)
        || !presentationValid(label, monogram, color)) {
      call.reject("INVALID_SHORTCUT");
      return null;
    }
    Context context = getContext();
    Intent intent = new Intent(ACTION_OPEN_APP);
    intent.setClass(context, SpaceEntryActivity.class);
    intent.putExtra(EXTRA_APP_ID, appId);
    return new ShortcutInfoCompat.Builder(context, shortcutId)
        .setShortLabel(label)
        .setLongLabel(label)
        .setIcon(monogramIcon(monogram, Color.parseColor(color)))
        .setIntent(intent)
        .build();
  }

  private static boolean presentationValid(String label, String monogram, String color) {
    return label != null && !label.trim().isEmpty() && label.length() <= MAX_LABEL && !hasControl(label)
        && monogram != null && MONOGRAM.matcher(monogram).matches()
        && color != null && COLOR.matcher(color).matches();
  }

  private static boolean hasControl(String value) {
    for (int i = 0; i < value.length(); i++) {
      char c = value.charAt(i);
      if (c < 0x20 || c == 0x7f) return true;
    }
    return false;
  }

  private static IconCompat monogramIcon(String monogram, int color) {
    return IconCompat.createWithAdaptiveBitmap(monogramBitmap(monogram, color));
  }

  private static Bitmap monogramBitmap(String monogram, int color) {
    Bitmap bitmap = Bitmap.createBitmap(ICON_PX, ICON_PX, Bitmap.Config.ARGB_8888);
    Canvas canvas = new Canvas(bitmap);
    canvas.drawColor(color);
    Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    paint.setColor(Color.WHITE);
    paint.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
    paint.setTextAlign(Paint.Align.CENTER);
    paint.setTextSize(ICON_PX * (monogram.length() > 1 ? 0.24f : 0.3f));
    Paint.FontMetrics metrics = paint.getFontMetrics();
    canvas.drawText(monogram, ICON_PX / 2f, ICON_PX / 2f - (metrics.ascent + metrics.descent) / 2f, paint);
    return bitmap;
  }
}
