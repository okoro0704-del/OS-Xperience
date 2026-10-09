package com.digiconomy.osexperience;

import android.content.Context;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.util.HashSet;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * OS Xperience ↔ background Space content delivery. OS Xperience names the Spaces to keep in sync
 * (brand routes only, re-validated here); the worker downloads while the app is closed; OS Xperience
 * reads what arrived, adopts it into the Offline Kernel, and releases the files.
 */
@CapacitorPlugin(name = "SpaceContentSync")
public class SpaceContentSyncPlugin extends Plugin {

  @PluginMethod
  public void setPlan(PluginCall call) {
    JSArray spaces = call.getArray("spaces");
    JSONArray accepted = new JSONArray();
    Set<String> seen = new HashSet<>();
    try {
      for (int i = 0; spaces != null && i < spaces.length() && accepted.length() < SpaceContentRules.MAX_SPACES; i++) {
        JSONObject space = spaces.optJSONObject(i);
        if (space == null) continue;
        String spaceId = space.optString("spaceId", null);
        String origin = space.optString("origin", null);
        String slug = space.optString("slug", null);
        if (!SpaceContentRules.validSpaceId(spaceId) || !SpaceContentRules.validRoute(origin, slug) || !seen.add(spaceId)) continue;
        JSONObject entry = new JSONObject().put("spaceId", spaceId).put("origin", origin).put("slug", slug);
        String name = SpaceContentRules.displayName(space.optString("name", null));
        if (name != null) entry.put("name", name);
        accepted.put(entry);
      }
    } catch (JSONException error) {
      call.reject("INVALID_PLAN");
      return;
    }
    Context context = getContext();
    android.content.SharedPreferences prefs = context.getSharedPreferences(SpaceContentSyncWorker.PREFS, Context.MODE_PRIVATE);
    boolean changed = !accepted.toString().equals(prefs.getString(SpaceContentSyncWorker.PLAN_KEY, null));
    if (changed) prefs.edit().putString(SpaceContentSyncWorker.PLAN_KEY, accepted.toString()).apply();
    if (accepted.length() > 0) SpaceContentSyncWorker.schedule(context, changed);
    else SpaceContentSyncWorker.cancel(context);
    JSObject result = new JSObject();
    result.put("accepted", accepted.length());
    call.resolve(result);
  }

  /** Delivered-but-not-yet-adopted posts, with their private file paths. */
  @PluginMethod
  public void readDelivered(PluginCall call) {
    Context context = getContext();
    JSArray spaces = new JSArray();
    File root = new File(context.getFilesDir(), "space-content");
    File[] dirs = root.listFiles();
    for (int i = 0; dirs != null && i < dirs.length; i++) {
      String spaceId = dirs[i].getName();
      if (!SpaceContentRules.validSpaceId(spaceId)) continue;
      JSONObject index = SpaceContentSyncWorker.readIndex(context, spaceId);
      if (index == null) continue;
      JSONArray items = index.optJSONArray("items");
      JSArray pending = new JSArray();
      for (int j = 0; items != null && j < items.length(); j++) {
        JSONObject item = items.optJSONObject(j);
        if (item == null || item.optBoolean("delivered", false)) continue;
        String itemId = item.optString("itemId");
        if (!SpaceContentRules.validItemId(itemId)) continue;
        File file = SpaceContentSyncWorker.itemFile(context, spaceId, itemId);
        if (!file.isFile()) continue;
        try {
          JSONObject copy = new JSONObject(item.toString());
          copy.put("path", file.getAbsolutePath());
          pending.put(copy);
        } catch (JSONException ignored) {
          // skip a malformed row
        }
      }
      JSObject space = new JSObject();
      space.put("spaceId", spaceId);
      space.put("publisherId", index.optString("publisherId", ""));
      space.put("catalogItemIds", index.optJSONArray("catalogItemIds") == null ? new JSONArray() : index.optJSONArray("catalogItemIds"));
      space.put("items", pending);
      spaces.put(space);
    }
    JSObject result = new JSObject();
    result.put("spaces", spaces);
    call.resolve(result);
  }

  /** Adopted posts: their files are deleted; the index remembers the version so it is not fetched again. */
  @PluginMethod
  public void release(PluginCall call) {
    String spaceId = call.getString("spaceId");
    JSArray itemIds = call.getArray("itemIds");
    if (!SpaceContentRules.validSpaceId(spaceId) || itemIds == null) {
      call.reject("INVALID_RELEASE");
      return;
    }
    Context context = getContext();
    Set<String> released = new HashSet<>();
    for (int i = 0; i < itemIds.length(); i++) {
      String itemId = itemIds.optString(i, null);
      if (SpaceContentRules.validItemId(itemId)) released.add(itemId);
    }
    synchronized (SpaceContentSyncWorker.class) {
      JSONObject index = SpaceContentSyncWorker.readIndex(context, spaceId);
      if (index != null) {
        JSONArray items = index.optJSONArray("items");
        try {
          for (int j = 0; items != null && j < items.length(); j++) {
            JSONObject item = items.optJSONObject(j);
            if (item != null && released.contains(item.optString("itemId"))) item.put("delivered", true);
          }
          SpaceContentSyncWorker.writeIndex(context, spaceId, index);
        } catch (Exception error) {
          call.reject("RELEASE_FAILED");
          return;
        }
      }
      for (String itemId : released) {
        //noinspection ResultOfMethodCallIgnored
        SpaceContentSyncWorker.itemFile(context, spaceId, itemId).delete();
      }
    }
    call.resolve();
  }
}
