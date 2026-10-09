package com.digiconomy.osexperience;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Rules for background Space content sync, kept free of Android types so they are unit-tested.
 * Mirrors packages/xperience-ui/src/local/space-library.ts: the route is the provider's own brand
 * origin (https://<slug>.getlifeos.app), read through its public, uncredentialed API only.
 */
final class SpaceContentRules {
  static final String BRAND_ROOT_DOMAIN = "getlifeos.app";
  static final int MAX_SPACES = 16;
  static final int MAX_ITEMS_PER_SPACE = 24;
  /** A single post larger than this is not taken in the background. */
  static final long MAX_ITEM_BYTES = 256L * 1024L * 1024L;

  private static final Pattern SPACE_ID = Pattern.compile("^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$");
  private static final Pattern SLUG = Pattern.compile("^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$");
  private static final Pattern ITEM_ID = Pattern.compile("^[A-Za-z0-9_-]{1,128}$");
  private static final Set<String> NON_BRAND_LABELS = new HashSet<>(Arrays.asList("www", "api", "app", "xperience", "portal", "studio"));
  private static final Set<String> AUDIO_TYPES = new HashSet<>(Arrays.asList("AUDIO", "MUSIC", "PODCAST", "RADIO"));
  private static final Set<String> IMAGE_TYPES = new HashSet<>(Arrays.asList("DESIGN", "IMAGE", "PHOTO", "ARTWORK"));

  private SpaceContentRules() {}

  static boolean validSpaceId(String value) {
    return value != null && SPACE_ID.matcher(value).matches();
  }

  /** A plan entry is accepted only when its origin is exactly the slug's brand origin. */
  static boolean validRoute(String origin, String slug) {
    if (slug == null || origin == null) return false;
    if (!SLUG.matcher(slug).matches() || NON_BRAND_LABELS.contains(slug)) return false;
    return origin.equals("https://" + slug + "." + BRAND_ROOT_DOMAIN);
  }

  static String catalogUrl(String origin, String slug) {
    return origin + "/api/public/" + slug + "/assets";
  }

  static boolean validItemId(String value) {
    return value != null && ITEM_ID.matcher(value).matches();
  }

  /** What a public asset becomes in the Space, or null when it has no public bytes. */
  static Entry entryFor(String origin, String slug, String id, String assetType, boolean mediaAvailable, boolean coverAvailable) {
    if (!validItemId(id)) return null;
    String type = assetType == null ? "" : assetType.toUpperCase(Locale.ROOT);
    String base = origin + "/api/public/" + slug + "/assets/" + id;
    if (mediaAvailable) {
      String kind = "VIDEO".equals(type) ? "VIDEO" : AUDIO_TYPES.contains(type) ? "AUDIO" : IMAGE_TYPES.contains(type) ? "IMAGE" : "OTHER";
      return new Entry(id, kind, base + "/media");
    }
    if (coverAvailable) return new Entry(id, "IMAGE", base + "/cover");
    return null;
  }

  /** The deployed site answers unknown paths with its HTML shell; that is never media. */
  static boolean acceptableContentType(String contentType) {
    if (contentType == null) return true;
    String bare = contentType.split(";")[0].trim().toLowerCase(Locale.ROOT);
    return !bare.equals("text/html");
  }

  /** Only https on the same brand host; a redirect elsewhere is not followed. */
  static boolean sameRoute(String url, String origin) {
    return url != null && (url.equals(origin) || url.startsWith(origin + "/"));
  }

  /** Start offset of a `Content-Range: bytes <start>-<end>/<total>` header, or -1. */
  static long rangeStart(String contentRange) {
    if (contentRange == null) return -1;
    java.util.regex.Matcher match = Pattern.compile("^bytes (\\d+)-(\\d+)/(\\d+|\\*)$").matcher(contentRange.trim());
    if (!match.matches()) return -1;
    try {
      return Long.parseLong(match.group(1));
    } catch (NumberFormatException error) {
      return -1;
    }
  }

  /** A file-name-safe key for a post's version, so a republished post never resumes an old file. */
  static String versionKey(String version) {
    String value = version == null ? "" : version;
    long hash = 1125899906842597L;
    for (int i = 0; i < value.length(); i++) hash = 31 * hash + value.charAt(i);
    return Long.toHexString(hash);
  }

  /** A Space name safe to show in a notification: printable, trimmed, at most 60 characters. */
  static String displayName(String value) {
    if (value == null) return null;
    StringBuilder clean = new StringBuilder();
    for (int i = 0; i < value.length() && clean.length() < 60; i++) {
      char c = value.charAt(i);
      if (!Character.isISOControl(c)) clean.append(c);
    }
    String result = clean.toString().trim();
    return result.isEmpty() ? null : result;
  }

  static final class Entry {
    final String itemId;
    final String kind;
    final String url;

    Entry(String itemId, String kind, String url) {
      this.itemId = itemId;
      this.kind = kind;
      this.url = url;
    }
  }
}
