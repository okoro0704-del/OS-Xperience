import type { CapacitorConfig } from "@capacitor/cli";

/**
 * OS Experience native shells — Android + iOS from the SAME web build.
 *
 * LIVE OTA (default): WebView loads https://os-xperience.netlify.app on every
 * launch. Deploy UI to Netlify → users get the new Experience automatically —
 * no new APK install for product/UI changes.
 *
 * Offline/bundled-only builds (Phase X1 style):
 *   OX_BUNDLED_ONLY=1
 * Custom live host:
 *   CAPACITOR_SERVER_URL=https://…
 */
const bundledOnly = process.env.OX_BUNDLED_ONLY === "1";
const liveUrl = bundledOnly
  ? ""
  : (process.env.CAPACITOR_SERVER_URL || process.env.OX_LIVE_URL || "https://os-xperience.netlify.app").trim();

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
      launchShowDuration: 1200,
      launchAutoHide: false,
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
