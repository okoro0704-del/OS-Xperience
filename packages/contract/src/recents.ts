import type { AppClass } from "./identity.js";
import { appKindFromClass, type AppKind } from "./lifecycle.js";
import { jsonLeaksSecrets } from "./permissions.js";
import { sanitizeLaunchUrl, urlContainsCredentialParams } from "./url.js";

export interface RecentApp {
  origin: string;
  href: string;
  name: string;
  class: AppClass;
  kind: AppKind;
  openedAt: string;
}

export interface FavoriteApp {
  origin: string;
  name: string;
  class: AppClass;
  kind: AppKind;
}

export function toRecentApp(input: {
  origin: string;
  href: string;
  name: string;
  class: AppClass;
  now?: Date;
}): RecentApp | null {
  const href = sanitizeLaunchUrl(input.href);
  if (urlContainsCredentialParams(href)) return null;
  const record: RecentApp = {
    origin: input.origin,
    href,
    name: input.name,
    class: input.class,
    kind: appKindFromClass(input.class),
    openedAt: (input.now ?? new Date()).toISOString(),
  };
  if (jsonLeaksSecrets(record)) return null;
  return record;
}

export function pushRecent(list: readonly RecentApp[], next: RecentApp, limit = 12): RecentApp[] {
  const rest = list.filter((item) => item.origin !== next.origin);
  return [next, ...rest].slice(0, limit);
}

export function toggleFavorite(list: readonly FavoriteApp[], item: FavoriteApp): FavoriteApp[] {
  if (list.some((entry) => entry.origin === item.origin)) {
    return list.filter((entry) => entry.origin !== item.origin);
  }
  if (jsonLeaksSecrets(item)) return [...list];
  return [...list, item];
}

export function isFavorite(list: readonly FavoriteApp[], origin: string): boolean {
  return list.some((item) => item.origin === origin);
}
