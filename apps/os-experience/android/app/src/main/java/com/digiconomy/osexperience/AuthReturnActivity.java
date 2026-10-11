package com.digiconomy.osexperience;

import android.app.Activity;
import android.net.Uri;
import android.os.Bundle;

/**
 * Receives {@code osxperience://auth/return?...} from the device browser after Trust ID sign-in
 * and hands it to {@link AuthReturnPlugin}, which brings the App / Space back. Shows nothing and
 * keeps no history. Anything else is ignored; the web layer validates the link's contents.
 */
public class AuthReturnActivity extends Activity {
  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    Uri data = getIntent() != null ? getIntent().getData() : null;
    if (data != null
      && "osxperience".equals(data.getScheme())
      && "auth".equals(data.getHost())
      && "/return".equals(data.getPath())) {
      AuthReturnPlugin.deliver(this, data.toString());
    }
    finish();
  }
}
