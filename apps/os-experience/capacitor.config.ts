import type { CapacitorConfig } from "@capacitor/cli";

/**
 * OS Experience native shells — Android + iOS from the SAME web build.
 *
 * Phase X1 offline reopen uses the bundled web assets by default so the shell
 * can start without contacting Netlify. Live OTA remains available:
 *   CAPACITOR_SERVER_URL=https://os-xperience.netlify.app
 *   or OX_LIVE_OTA=1
 */
const liveOta = process.env.OX_LIVE_OTA === "1" || Boolean(process.env.CAPACITOR_SERVER_URL?.trim());
const liveUrl = liveOta
  ? (process.env.CAPACITOR_SERVER_URL || process.env.OX_LIVE_URL || "https://os-xperience.netlify.app").trim()
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
