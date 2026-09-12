package com.digiconomy.osshell;

import android.content.Intent;
import android.content.pm.PackageManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Minimal bridge: open a first-party Android package by id.
 * Does not expose credentials, filesystem, or secrets.
 */
@CapacitorPlugin(name = "ShellAppLauncher")
public class ShellAppLauncherPlugin extends Plugin {

  @PluginMethod
  public void canOpen(PluginCall call) {
    String packageName = call.getString("packageName");
    if (packageName == null || packageName.isEmpty()) {
      call.reject("packageName required");
      return;
    }
    PackageManager pm = getContext().getPackageManager();
    Intent launch = pm.getLaunchIntentForPackage(packageName);
    JSObject result = new JSObject();
    result.put("value", launch != null);
    call.resolve(result);
  }

  @PluginMethod
  public void open(PluginCall call) {
    String packageName = call.getString("packageName");
    if (packageName == null || packageName.isEmpty()) {
      call.reject("packageName required");
      return;
    }
    PackageManager pm = getContext().getPackageManager();
    Intent launch = pm.getLaunchIntentForPackage(packageName);
    if (launch == null) {
      call.reject("not_installed");
      return;
    }
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    getContext().startActivity(launch);
    call.resolve();
  }
}
