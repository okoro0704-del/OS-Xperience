package com.digiconomy.osexperience;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** The background worker reads only the provider's own public brand API — never a guessed host. */
public class SpaceContentRulesTest {
  private static final String ORIGIN = "https://mrfundzman.getlifeos.app";

  @Test
  public void routeIsExactlyTheSlugsBrandOrigin() {
    assertTrue(SpaceContentRules.validRoute(ORIGIN, "mrfundzman"));
    assertFalse(SpaceContentRules.validRoute("http://mrfundzman.getlifeos.app", "mrfundzman"));
    assertFalse(SpaceContentRules.validRoute("https://mrfundzman.getlifeos.app:8443", "mrfundzman"));
    assertFalse(SpaceContentRules.validRoute("https://evil.test", "mrfundzman"));
    assertFalse(SpaceContentRules.validRoute("https://other.getlifeos.app", "mrfundzman"));
    assertFalse(SpaceContentRules.validRoute("https://xperience.getlifeos.app", "xperience"));
    assertFalse(SpaceContentRules.validRoute("https://a.b.getlifeos.app", "a.b"));
    assertFalse(SpaceContentRules.validRoute(null, "mrfundzman"));
  }

  @Test
  public void publicAssetsMapLikeTheWebSync() {
    SpaceContentRules.Entry video = SpaceContentRules.entryFor(ORIGIN, "mrfundzman", "vid1", "VIDEO", true, false);
    assertEquals("VIDEO", video.kind);
    assertEquals(ORIGIN + "/api/public/mrfundzman/assets/vid1/media", video.url);
    SpaceContentRules.Entry design = SpaceContentRules.entryFor(ORIGIN, "mrfundzman", "des1", "DESIGN", false, true);
    assertEquals("IMAGE", design.kind);
    assertEquals(ORIGIN + "/api/public/mrfundzman/assets/des1/cover", design.url);
    assertEquals("AUDIO", SpaceContentRules.entryFor(ORIGIN, "mrfundzman", "s1", "music", true, false).kind);
    assertNull("no public bytes", SpaceContentRules.entryFor(ORIGIN, "mrfundzman", "x", "VIDEO", false, false));
    assertNull("unsafe id", SpaceContentRules.entryFor(ORIGIN, "mrfundzman", "../x", "VIDEO", true, false));
  }

  @Test
  public void htmlIsNeverMediaAndRequestsStayOnRoute() {
    assertFalse(SpaceContentRules.acceptableContentType("text/html; charset=utf-8"));
    assertTrue(SpaceContentRules.acceptableContentType("video/mp4"));
    assertTrue(SpaceContentRules.sameRoute(ORIGIN + "/api/public/mrfundzman/assets", ORIGIN));
    assertFalse(SpaceContentRules.sameRoute("https://mrfundzman.getlifeos.app.evil.test/x", ORIGIN));
    assertFalse(SpaceContentRules.sameRoute("https://evil.test/", ORIGIN));
  }

  @Test
  public void spaceIdsFollowTheSpaceGrammar() {
    assertTrue(SpaceContentRules.validSpaceId("bootstrap.mybrandos.public"));
    assertFalse(SpaceContentRules.validSpaceId("../etc"));
    assertFalse(SpaceContentRules.validSpaceId("Bad Id"));
  }

  @Test
  public void resumeOnlyFromTheExactOffsetAndVersion() {
    assertEquals(286517L, SpaceContentRules.rangeStart("bytes 286517-6140922/6140923"));
    assertEquals(0L, SpaceContentRules.rangeStart("bytes 0-0/6140923"));
    assertEquals(-1L, SpaceContentRules.rangeStart(null));
    assertEquals(-1L, SpaceContentRules.rangeStart("items 0-1/2"));
    assertEquals(SpaceContentRules.versionKey("2026-09-20T03:22:59.022Z"), SpaceContentRules.versionKey("2026-09-20T03:22:59.022Z"));
    assertFalse(SpaceContentRules.versionKey("2026-09-20T03:22:59.022Z").equals(SpaceContentRules.versionKey("2026-10-01T00:00:00.000Z")));
  }
}
