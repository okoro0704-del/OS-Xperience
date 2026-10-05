package com.digiconomy.osexperience;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;

/**
 * Target of every Space home-screen entry. Not exported: only the launcher (acting for this
 * package) and OS Xperience itself can start it. It hands the untrusted launch request to
 * {@link SpaceHomeEntryPlugin} in-process and brings the single OS Xperience task forward, so
 * a running OS Xperience switches Space instead of being cleared and restarted.
 */
public class SpaceEntryActivity extends Activity {
  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    SpaceHomeEntryPlugin.offer(getIntent());
    Intent host = new Intent(this, MainActivity.class);
    host.setAction(Intent.ACTION_MAIN);
    host.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    startActivity(host);
    finish();
    overridePendingTransition(0, 0);
  }
}
