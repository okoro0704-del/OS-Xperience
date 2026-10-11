package com.digiconomy.osexperience;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Sign-in return from the device browser (Custom Tab) to the App / Space that opened it.
 *
 * Before an App opens its own sign-in page in the browser, the web layer calls {@link #prepare},
 * recording which activity (OS Xperience or an installed App / Space task) to come back to. When
 * the browser follows an {@code osxperience://auth/return?...} link, {@link AuthReturnActivity}
 * calls {@link #deliver}: that activity is brought back to the front (closing the browser tab
 * above it, without reloading the App), and the link is handed to the web layer as an
 * {@code authReturn} event. The link carries no session — only a one-time approval that works
 * solely for the App that started that sign-in.
 */
@CapacitorPlugin(name = "AuthReturn")
public class AuthReturnPlugin extends Plugin {
  static final String EXTRA_AUTH_RETURN = "com.digiconomy.osexperience.extra.AUTH_RETURN";

  private static volatile AuthReturnPlugin active;
  private static volatile Intent returnIntent;

  @Override
  public void load() {
    if (active == null) active = this;
  }

  @PluginMethod
  public void prepare(PluginCall call) {
    active = this;
    Activity activity = getActivity();
    if (activity != null && activity.getIntent() != null) {
      Intent back = new Intent(activity.getIntent());
      back.setComponent(activity.getComponentName());
      returnIntent = back;
    }
    call.resolve();
  }

  static void deliver(Context context, String url) {
    Intent opener = returnIntent;
    Intent back = opener != null ? new Intent(opener) : new Intent(context, MainActivity.class);
    back.putExtra(EXTRA_AUTH_RETURN, true);
    back.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    context.startActivity(back);
    AuthReturnPlugin plugin = active;
    if (plugin != null) plugin.emit(url);
  }

  private void emit(String url) {
    JSObject data = new JSObject();
    data.put("url", url);
    notifyListeners("authReturn", data, true);
  }
}
