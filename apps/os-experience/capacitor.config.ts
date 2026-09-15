import type { CapacitorConfig } from "@capacitor/cli";

/** OS Experience native shell — separate from OS Shell (com.digiconomy.osshell). */
const config: CapacitorConfig = {
  appId: "com.digiconomy.osexperience",
  appName: "OS Experience",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
  android: {
    allowMixedContent: false,
    backgroundColor: "#05070f",
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
