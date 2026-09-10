import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.digiconomy.osshell",
  appName: "OS Shell",
  webDir: "apps/web/dist",
  server: {
    androidScheme: "https",
    // Production loads bundled assets. Do not point release builds at localhost.
  },
  android: {
    allowMixedContent: false,
    backgroundColor: "#0f172a",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      backgroundColor: "#0f172a",
      showSpinner: false,
    },
  },
};

export default config;
