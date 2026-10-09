package com.digiconomy.osexperience;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import com.getcapacitor.JSObject;

/**
 * Target of every home-screen entry (Space Installation V1 Spaces and installed Apps). Not
 * exported: only the launcher (acting for this package) and OS Xperience itself can start it.
 * It normalizes the untrusted launch request and opens it in {@link TargetActivity} — the target's
 * own task — so the OS Xperience task is never brought forward on the way to a target.
 */
public class SpaceEntryActivity extends Activity {
  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    JSObject launch = SpaceHomeEntryPlugin.normalize(getIntent());
    Intent target = new Intent(this, TargetActivity.class);
    // Task identity only (format-checked); OS Xperience still validates the launch itself.
    target.setData(Uri.parse("ox-target:" + SpaceHomeEntryPlugin.taskIdentity(launch)));
    target.putExtra(TargetActivity.EXTRA_LAUNCH, launch.toString());
    startActivity(target);
    finish();
    overridePendingTransition(0, 0);
  }
}
