import type { CapacitorConfig } from "@capacitor/cli";

/**
 * OS Experience native shells — Android + iOS from the SAME web build.
 *
 * RELEASE / DEFAULT: bundled `webDir` only (X1 offline startup).
 * The APK must boot from local assets — never require Netlify/Railway to paint UI.
 *
 * Optional live WebView (debug / special OTA shells ONLY):
 *   OX_LIVE_OTA=1
 *   CAPACITOR_SERVER_URL=https://…
 */
const liveOta = process.env.OX_LIVE_OTA === "1";
const liveUrl = liveOta
  ? (process.env.CAPACITOR_SERVER_URL || process.env.OX_LIVE_URL || "").trim()
  : "";

const config: CapacitorConfig = {
  appId: "com.digiconomy.osexperience",
  appName: "OS Xperience",
  webDir: "dist",
  server: {
    androidScheme: "https",
    iosScheme: "https",
    ...(liveUrl
      ? {
          url: liveUrl,
          cleartext: false,
        }
      : {}),
  },
  android: {
    allowMixedContent: false,
    backgroundColor: "#05070f",
  },
  ios: {
    backgroundColor: "#05070f",
    contentInset: "never",
    preferredContentMode: "mobile",
    scrollEnabled: true,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 400,
      launchAutoHide: true,
      backgroundColor: "#05070f",
      showSpinner: false,
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#05070f",
    },
    Keyboard: {
      resize: "body",
      resizeOnFullScreen: true,
    },
  },
};

export default config;
