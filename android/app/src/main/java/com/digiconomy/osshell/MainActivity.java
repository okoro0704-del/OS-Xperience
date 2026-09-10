package com.digiconomy.osshell;

import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    // Never enable WebView debugging in production release builds.
    WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
  }
}
