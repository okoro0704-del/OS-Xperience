import type { CapacitorConfig } from "@capacitor/cli";

/**
 * OS Experience native shells — Android + iOS from the SAME web build.
 * Separate from OS Shell (com.digiconomy.osshell).
 */
const config: CapacitorConfig = {
  appId: "com.digiconomy.osexperience",
  appName: "OS Xperience",
  webDir: "dist",
  server: {
    androidScheme: "https",
    iosScheme: "https",
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
