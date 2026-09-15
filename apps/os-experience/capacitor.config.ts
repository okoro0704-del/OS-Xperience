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
      launchShowDuration: 900,
      backgroundColor: "#05070f",
      showSpinner: false,
    },
  },
};

export default config;
