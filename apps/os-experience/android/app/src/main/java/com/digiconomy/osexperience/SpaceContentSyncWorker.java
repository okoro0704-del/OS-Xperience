package com.digiconomy.osexperience;

import android.content.Context;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.work.ForegroundInfo;
import androidx.work.OutOfQuotaPolicy;
import android.util.Log;
import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.ReentrantLock;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Background delivery of Space content: while OS Xperience is closed, each planned Space's published
 * posts are downloaded whenever the device has a connection. Nobody prepares a Space by hand.
 *
 * Files live in the app's private storage (filesDir/space-content/<spaceId>/) until OS Xperience
 * adopts them into the Offline Kernel and releases them. Public, uncredentialed GETs to the
 * provider's own brand origin only; no cookie, token or identity is ever sent.
 */
public class SpaceContentSyncWorker extends Worker {
  private static final String TAG = "OxSpaceSync";
  static final String PREFS = "ox.space-content-sync";
  static final String PLAN_KEY = "plan";
  private static final String PERIODIC = "ox-space-content-sync";
  private static final String NOW = "ox-space-content-sync-now";
  private static final int CONNECT_TIMEOUT_MS = 20_000;
  private static final int READ_TIMEOUT_MS = 60_000;
  /** One sync at a time per device: two runs writing the same item would undo each other. */
  private static final ReentrantLock RUNNING = new ReentrantLock();
  private static final String CHANNEL = "ox-space-sync";
  private static final int NOTIFICATION_ID = 0x5ace;
  /** Set once Android has refused foreground status for this run (Android 12+ background start). */
  private boolean foregroundRefused = false;

  public SpaceContentSyncWorker(@NonNull Context context, @NonNull WorkerParameters params) {
    super(context, params);
  }

  /**
   * Keeps delivery running: once now (when connected) and periodically after that. A download in
   * progress is never interrupted by an unchanged plan; anything merely waiting (a retry backoff)
   * starts again now — while OS Xperience is open, the one moment a foreground service may start.
   */
  static void schedule(Context context, boolean planChanged) {
    Constraints constraints = new Constraints.Builder()
      .setRequiredNetworkType(NetworkType.CONNECTED)
      .setRequiresStorageNotLow(true)
      .build();
    WorkManager manager = WorkManager.getInstance(context);
    manager.enqueueUniqueWork(NOW, !planChanged && running(manager) ? ExistingWorkPolicy.KEEP : ExistingWorkPolicy.REPLACE,
      // Expedited: started promptly; it may run as a foreground "Syncing" service while it downloads.
      new OneTimeWorkRequest.Builder(SpaceContentSyncWorker.class).setConstraints(constraints)
        .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST).build());
    manager.enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP,
      // The first periodic run waits an interval: the immediate run above covers now.
      new PeriodicWorkRequest.Builder(SpaceContentSyncWorker.class, 1, TimeUnit.HOURS).setConstraints(constraints).setInitialDelay(1, TimeUnit.HOURS).build());
  }

  /** Required for expedited work before Android 12, where it runs as a foreground service. */
  @NonNull
  @Override
  public ForegroundInfo getForegroundInfo() {
    return foregroundInfo(null, "Syncing Space content", 0, 0);
  }

  private ForegroundInfo foregroundInfo(String spaceName, String detail, int done, int total) {
    Context context = getApplicationContext();
    NotificationManager manager = context.getSystemService(NotificationManager.class);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager != null && manager.getNotificationChannel(CHANNEL) == null) {
      NotificationChannel channel = new NotificationChannel(CHANNEL, "Space content", NotificationManager.IMPORTANCE_LOW);
      channel.setDescription("Brings the posts of your Spaces to this device so they work without internet.");
      manager.createNotificationChannel(channel);
    }
    Notification notification = new NotificationCompat.Builder(context, CHANNEL)
      .setSmallIcon(R.drawable.ic_stat_space_sync)
      .setContentTitle(spaceName == null ? "Syncing Spaces" : "Syncing " + spaceName)
      .setContentText(detail)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setCategory(NotificationCompat.CATEGORY_PROGRESS)
      .setProgress(total, done, total == 0)
      .build();
    return Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
      ? new ForegroundInfo(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
      : new ForegroundInfo(NOTIFICATION_ID, notification);
  }

  /**
   * Runs the download as a visible foreground service so OEM battery managers (ColorOS freezes and
   * firewalls background apps) let it finish. Android 12+ may refuse this when the run started in
   * the background; delivery then continues as ordinary background work.
   */
  private void promote(String spaceName, String detail, int done, int total) {
    if (foregroundRefused) return;
    try {
      setForegroundAsync(foregroundInfo(spaceName, detail, done, total)).get();
    } catch (Exception error) {
      foregroundRefused = true;
      Log.w(TAG, "foreground refused: " + error.getClass().getSimpleName());
    }
  }

  private static boolean running(WorkManager manager) {
    try {
      for (androidx.work.WorkInfo info : manager.getWorkInfosForUniqueWork(NOW).get()) {
        if (info.getState() == androidx.work.WorkInfo.State.RUNNING) return true;
      }
    } catch (Exception ignored) {
      // unknown: start now
    }
    return false;
  }

  static void cancel(Context context) {
    WorkManager manager = WorkManager.getInstance(context);
    manager.cancelUniqueWork(NOW);
    manager.cancelUniqueWork(PERIODIC);
  }

  static File spaceDir(Context context, String spaceId) {
    return new File(new File(context.getFilesDir(), "space-content"), spaceId);
  }

  static File indexFile(Context context, String spaceId) {
    return new File(spaceDir(context, spaceId), "index.json");
  }

  static File itemFile(Context context, String spaceId, String itemId) {
    return new File(new File(spaceDir(context, spaceId), "items"), itemId + ".bin");
  }

  static JSONObject readIndex(Context context, String spaceId) {
    File file = indexFile(context, spaceId);
    if (!file.isFile()) return null;
    try (InputStream in = new java.io.FileInputStream(file)) {
      return new JSONObject(new String(readAll(in, 4 * 1024 * 1024), StandardCharsets.UTF_8));
    } catch (IOException | JSONException error) {
      return null;
    }
  }

  static synchronized void writeIndex(Context context, String spaceId, JSONObject index) throws IOException {
    File dir = spaceDir(context, spaceId);
    if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("NO_SPACE_DIR");
    File temp = new File(dir, "index.json.part");
    try (OutputStream out = new FileOutputStream(temp)) {
      out.write(index.toString().getBytes(StandardCharsets.UTF_8));
    }
    if (!temp.renameTo(indexFile(context, spaceId))) throw new IOException("INDEX_RENAME_FAILED");
  }

  @NonNull
  @Override
  public Result doWork() {
    // Another run is already delivering: it covers this one.
    if (!RUNNING.tryLock()) return Result.success();
    try {
      return syncPlannedSpaces();
    } finally {
      RUNNING.unlock();
    }
  }

  private Result syncPlannedSpaces() {
    SharedPreferences prefs = getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    JSONArray plan;
    try {
      plan = new JSONArray(prefs.getString(PLAN_KEY, "[]"));
    } catch (JSONException error) {
      return Result.success();
    }
    boolean retry = false;
    for (int index = 0; index < plan.length() && index < SpaceContentRules.MAX_SPACES; index++) {
      JSONObject space = plan.optJSONObject(index);
      if (space == null) continue;
      String spaceId = space.optString("spaceId", null);
      String origin = space.optString("origin", null);
      String slug = space.optString("slug", null);
      String name = SpaceContentRules.displayName(space.optString("name", null));
      if (!SpaceContentRules.validSpaceId(spaceId) || !SpaceContentRules.validRoute(origin, slug)) continue;
      if (isStopped()) return Result.retry();
      try {
        syncSpace(spaceId, origin, slug, name);
      } catch (IOException | JSONException error) {
        Log.w(TAG, "sync deferred for " + spaceId + ": " + error.getClass().getSimpleName());
        retry = true;
      }
    }
    return retry ? Result.retry() : Result.success();
  }

  private void syncSpace(String spaceId, String origin, String slug, String name) throws IOException, JSONException {
    Context context = getApplicationContext();
    JSONObject catalog = new JSONObject(new String(get(SpaceContentRules.catalogUrl(origin, slug), origin, 4 * 1024 * 1024).bytes, StandardCharsets.UTF_8));
    JSONArray assets = catalog.optJSONArray("assets");
    if (assets == null) throw new JSONException("CATALOG_INVALID");

    JSONObject previous = readIndex(context, spaceId);
    Map<String, JSONObject> held = new HashMap<>();
    if (previous != null) {
      JSONArray items = previous.optJSONArray("items");
      for (int i = 0; items != null && i < items.length(); i++) {
        JSONObject item = items.optJSONObject(i);
        if (item != null) held.put(item.optString("itemId"), item);
      }
    }

    JSONArray catalogItemIds = new JSONArray();
    JSONArray items = new JSONArray();
    Set<String> kept = new HashSet<>();
    int taken = 0;
    for (int i = 0; i < assets.length() && taken < SpaceContentRules.MAX_ITEMS_PER_SPACE; i++) {
      JSONObject asset = assets.optJSONObject(i);
      if (asset == null) continue;
      SpaceContentRules.Entry entry = SpaceContentRules.entryFor(origin, slug, asset.optString("id", null), asset.optString("assetType", ""),
        asset.optBoolean("mediaAvailable", false), asset.optBoolean("coverAvailable", false));
      if (entry == null) continue;
      taken++;
      catalogItemIds.put(entry.itemId);
      String version = asset.isNull("publishedAt") ? "" : asset.optString("publishedAt", "");
      JSONObject known = held.get(entry.itemId);
      File file = itemFile(context, spaceId, entry.itemId);
      boolean current = known != null && version.equals(known.optString("version")) && (known.optBoolean("delivered", false) || file.isFile());
      if (current) {
        items.put(known);
        kept.add(entry.itemId);
        continue;
      }
      if (isStopped()) break;
      promote(name, "Post " + taken + " of " + Math.min(assets.length(), SpaceContentRules.MAX_ITEMS_PER_SPACE), taken - 1, Math.min(assets.length(), SpaceContentRules.MAX_ITEMS_PER_SPACE));
      try {
        Fetched fetched = download(entry.url, origin, file, version);
        JSONObject item = new JSONObject();
        item.put("itemId", entry.itemId);
        item.put("title", asset.optString("title", entry.itemId));
        item.put("description", asset.optString("description", ""));
        item.put("kind", entry.kind);
        item.put("contentType", fetched.contentType == null ? JSONObject.NULL : fetched.contentType);
        item.put("version", version);
        item.put("publishedAt", version.isEmpty() ? JSONObject.NULL : version);
        item.put("byteLength", fetched.length);
        item.put("delivered", false);
        items.put(item);
        kept.add(entry.itemId);
      } catch (IOException error) {
        // An older held copy stays until the new version arrives.
        if (known != null) {
          items.put(known);
          kept.add(entry.itemId);
        }
      }
    }
    // What the publisher no longer publishes leaves this device.
    for (String itemId : held.keySet()) {
      if (!kept.contains(itemId)) {
        //noinspection ResultOfMethodCallIgnored
        itemFile(context, spaceId, itemId).delete();
      }
    }
    JSONObject index = new JSONObject();
    index.put("spaceId", spaceId);
    index.put("publisherId", slug);
    index.put("syncedAt", iso(new Date()));
    index.put("catalogItemIds", catalogItemIds);
    index.put("items", items);
    writeIndex(context, spaceId, index);
  }

  private static final class Fetched {
    final byte[] bytes;
    final String contentType;
    final long length;

    Fetched(byte[] bytes, String contentType, long length) {
      this.bytes = bytes;
      this.contentType = contentType;
      this.length = length;
    }
  }

  private static HttpURLConnection open(String url, String origin, long resumeFrom) throws IOException {
    if (!SpaceContentRules.sameRoute(url, origin)) throw new IOException("OFF_ROUTE");
    HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
    connection.setInstanceFollowRedirects(false);
    connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
    connection.setReadTimeout(READ_TIMEOUT_MS);
    connection.setUseCaches(false);
    connection.setRequestProperty("Accept", "*/*");
    if (resumeFrom > 0) connection.setRequestProperty("Range", "bytes=" + resumeFrom + "-");
    int status = connection.getResponseCode();
    if (status < 200 || status >= 300) {
      connection.disconnect();
      throw new IOException("HTTP_" + status);
    }
    return connection;
  }

  private static Fetched get(String url, String origin, int maxBytes) throws IOException {
    HttpURLConnection connection = open(url, origin, 0);
    try (InputStream in = connection.getInputStream()) {
      byte[] bytes = readAll(in, maxBytes);
      return new Fetched(bytes, connection.getContentType(), bytes.length);
    } finally {
      connection.disconnect();
    }
  }

  /**
   * Streams to a .part file, then renames: a half-downloaded post is never visible. On a dropped
   * connection the .part is kept and the next run resumes it (HTTP Range) instead of starting over:
   * on slow, unstable networks a post arrives a piece at a time. The .part is keyed to the post's
   * version, so a republished post never continues an older file.
   */
  private static Fetched download(String url, String origin, File target, String version) throws IOException {
    File dir = target.getParentFile();
    if (dir != null && !dir.isDirectory() && !dir.mkdirs()) throw new IOException("NO_ITEM_DIR");
    String base = target.getName();
    File part = new File(dir, base + "." + SpaceContentRules.versionKey(version) + ".part");
    File[] stale = dir == null ? null : dir.listFiles((parent, name) -> name.startsWith(base + ".") && name.endsWith(".part") && !name.equals(part.getName()));
    for (int i = 0; stale != null && i < stale.length; i++) {
      //noinspection ResultOfMethodCallIgnored
      stale[i].delete();
    }
    long have = part.isFile() ? part.length() : 0;
    HttpURLConnection connection = open(url, origin, have);
    boolean keepPart = true;
    try {
      String contentType = connection.getContentType();
      if (!SpaceContentRules.acceptableContentType(contentType)) { keepPart = false; throw new IOException("NOT_MEDIA"); }
      boolean resumed = have > 0 && connection.getResponseCode() == 206 && SpaceContentRules.rangeStart(connection.getHeaderField("Content-Range")) == have;
      if (!resumed) have = 0;
      long declared = connection.getContentLengthLong();
      if (declared > 0 && have + declared > SpaceContentRules.MAX_ITEM_BYTES) { keepPart = false; throw new IOException("TOO_LARGE"); }
      long total = have;
      try (InputStream in = connection.getInputStream(); OutputStream out = new FileOutputStream(part, resumed)) {
        byte[] buffer = new byte[64 * 1024];
        int read;
        while ((read = in.read(buffer)) != -1) {
          total += read;
          if (total > SpaceContentRules.MAX_ITEM_BYTES) { keepPart = false; throw new IOException("TOO_LARGE"); }
          out.write(buffer, 0, read);
        }
      }
      if (total == 0) { keepPart = false; throw new IOException("EMPTY"); }
      if (!part.renameTo(target)) throw new IOException("RENAME_FAILED");
      keepPart = false;
      return new Fetched(null, contentType == null ? null : contentType.split(";")[0].trim(), total);
    } finally {
      if (!keepPart) {
        //noinspection ResultOfMethodCallIgnored
        part.delete();
      }
      connection.disconnect();
    }
  }

  private static byte[] readAll(InputStream in, int maxBytes) throws IOException {
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    byte[] buffer = new byte[16 * 1024];
    int read;
    while ((read = in.read(buffer)) != -1) {
      if (out.size() + read > maxBytes) throw new IOException("TOO_LARGE");
      out.write(buffer, 0, read);
    }
    return out.toByteArray();
  }

  private static String iso(Date date) {
    SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
    format.setTimeZone(TimeZone.getTimeZone("UTC"));
    return format.format(date);
  }
}
