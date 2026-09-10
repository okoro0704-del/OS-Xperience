export type ShellPlatform = "web" | "android" | "ios" | "desktop";

export const CURRENT_SHELL_PLATFORM: ShellPlatform = "web";

/** Honest host support. The Shell does not emulate missing OS privileges. */
export function platformSupports(capability: string, platform: ShellPlatform = CURRENT_SHELL_PLATFORM): {
  supported: boolean;
  code?: "capability_unavailable";
  detail: string;
} {
  if (platform === "web") {
    return { supported: true, detail: "The web host can mediate this contract. Provider readiness is separate." };
  }
  void capability;
  return {
    supported: false,
    code: "capability_unavailable",
    detail: `${platform} Shell is not implemented. Missing platform privileges are not emulated.`,
  };
}
