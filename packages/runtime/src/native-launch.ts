import {
  NATIVE_APP_DESCRIPTORS,
  decideLoad,
  defaultOriginPolicy,
  nativeAppForOrigin,
  originOf,
  sanitizeLaunchUrl,
  type LoadDecision,
  type NativeAppDescriptor,
  type OriginPolicy,
} from "@osshell/contract";

export function nativeLaunch(appId: NativeAppDescriptor["id"], policy: OriginPolicy = defaultOriginPolicy()): LoadDecision | { error: string } {
  const app = NATIVE_APP_DESCRIPTORS.find((item) => item.id === appId);
  if (!app) return { error: "Unknown native app." };
  const href = sanitizeLaunchUrl(app.origins.find((origin) => policy.nativeOrigins.includes(origin)) ?? app.origins[0]!);
  const origin = originOf(href);
  if (!origin || !nativeAppForOrigin(origin)) return { error: "Native origin is not in the origin policy." };
  return decideLoad({
    href,
    origin,
    preferEmbed: true,
    native: true,
    manifestEmbed: "allow",
  });
}

export function firstPartyOrigins(policy: OriginPolicy = defaultOriginPolicy()): NativeAppDescriptor[] {
  return NATIVE_APP_DESCRIPTORS.filter((app) => app.origins.some((origin) => policy.nativeOrigins.includes(origin)));
}
