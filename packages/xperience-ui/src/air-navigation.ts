/**
 * Host-owned Air Navigation: Palm → Fist → Throw → exitExperienceToHome().
 * Camera frames stay on-device; no upload, no face recognition.
 */

export type AirNavState =
  | "idle"
  | "camera"
  | "hand_none"
  | "palm_armed"
  | "grabbed"
  | "throw"
  | "error"
  | "denied";

export type AirNavDebugSnapshot = {
  camera: "off" | "starting" | "ready" | "error" | "denied";
  hand: "none" | "detected";
  gesture: "none" | "open_palm" | "fist";
  motion: "none" | "throw_left" | "throw_right";
  state: AirNavState;
  action?: "EXIT_HOME";
  detail?: string;
};

export const AIR_NAV_ENABLED_KEY = "ox.airNavigation.enabled";
export const AIR_NAV_DEBUG_KEY = "ox.airNavigation.debug";

const PALM_HOLD_MS = 280;
const FIST_WINDOW_MS = 900;
const THROW_WINDOW_MS = 650;
const THROW_MIN_DX = 0.12; // normalized video width
const THROW_MIN_VELOCITY = 0.55; // widths / second

type Point = { x: number; y: number };

function fingerExtended(landmarks: Point[], tip: number, pip: number, mcp: number): boolean {
  // Tip farther from wrist (0) than pip — simple open-finger heuristic.
  const wrist = landmarks[0]!;
  const tipD = Math.hypot(landmarks[tip]!.x - wrist.x, landmarks[tip]!.y - wrist.y);
  const pipD = Math.hypot(landmarks[pip]!.x - wrist.x, landmarks[pip]!.y - wrist.y);
  void mcp;
  return tipD > pipD * 1.08;
}

export function classifyHandPose(landmarks: Point[]): "open_palm" | "fist" | "none" {
  if (!landmarks || landmarks.length < 21) return "none";
  const ext = [
    fingerExtended(landmarks, 8, 6, 5),
    fingerExtended(landmarks, 12, 10, 9),
    fingerExtended(landmarks, 16, 14, 13),
    fingerExtended(landmarks, 20, 18, 17),
  ];
  const openCount = ext.filter(Boolean).length;
  if (openCount >= 3) return "open_palm";
  if (openCount <= 1) return "fist";
  return "none";
}

export function handCentroid(landmarks: Point[]): Point {
  const i = [0, 5, 9, 13, 17];
  let x = 0;
  let y = 0;
  for (const idx of i) {
    x += landmarks[idx]!.x;
    y += landmarks[idx]!.y;
  }
  return { x: x / i.length, y: y / i.length };
}

export function isAirNavigationEnabled(): boolean {
  try {
    return localStorage.getItem(AIR_NAV_ENABLED_KEY) === "1";
  } catch {
    return false;
  }
}

export function setAirNavigationEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(AIR_NAV_ENABLED_KEY, enabled ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function isAirNavigationDebug(): boolean {
  try {
    if (localStorage.getItem(AIR_NAV_DEBUG_KEY) === "1") return true;
    if (typeof document !== "undefined" && document.documentElement.dataset.oxDebug === "1") return true;
  } catch {
    /* ignore */
  }
  return Boolean((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV);
}

export interface AirNavigationController {
  stop: () => void;
  getDebug: () => AirNavDebugSnapshot;
}

export async function startAirNavigation(options: {
  onExitHome: () => void;
  onGrabbed?: (grabbed: boolean) => void;
  onDebug?: (snap: AirNavDebugSnapshot) => void;
}): Promise<AirNavigationController> {
  let stopped = false;
  let raf = 0;
  let stream: MediaStream | null = null;
  let landmarker: { detectForVideo: (video: HTMLVideoElement, ts: number) => { landmarks: Array<Array<{ x: number; y: number }>> }; close?: () => void } | null = null;
  let video: HTMLVideoElement | null = null;

  let state: AirNavState = "camera";
  let camera: AirNavDebugSnapshot["camera"] = "starting";
  let hand: AirNavDebugSnapshot["hand"] = "none";
  let gesture: AirNavDebugSnapshot["gesture"] = "none";
  let motion: AirNavDebugSnapshot["motion"] = "none";
  let detail = "";
  let action: AirNavDebugSnapshot["action"];

  let palmSince = 0;
  let fistSince = 0;
  let grabOrigin: Point | null = null;
  let grabAt = 0;
  let lastCentroid: Point | null = null;
  let lastAt = 0;

  const publish = () => {
    options.onDebug?.({
      camera,
      hand,
      gesture,
      motion,
      state,
      action,
      detail,
    });
  };

  const resetSequence = (next: AirNavState = "hand_none") => {
    state = next;
    palmSince = 0;
    fistSince = 0;
    grabOrigin = null;
    grabAt = 0;
    motion = "none";
    action = undefined;
    options.onGrabbed?.(false);
    publish();
  };

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
    });
  } catch (error) {
    const name = error instanceof DOMException ? error.name : "";
    camera = name === "NotAllowedError" || name === "PermissionDeniedError" ? "denied" : "error";
    state = camera === "denied" ? "denied" : "error";
    detail = error instanceof Error ? error.message : "camera_failed";
    publish();
    return {
      stop: () => undefined,
      getDebug: () => ({ camera, hand, gesture, motion, state, action, detail }),
    };
  }

  video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "true");
  video.srcObject = stream;
  await video.play();
  camera = "ready";
  state = "hand_none";
  publish();

  try {
    const mod = await import("@mediapipe/tasks-vision");
    const vision = await mod.FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm",
    );
    landmarker = await mod.HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numHands: 1,
    });
  } catch (error) {
    camera = "error";
    state = "error";
    detail = error instanceof Error ? error.message : "hand_detector_failed";
    publish();
    stream.getTracks().forEach((t) => t.stop());
    return {
      stop: () => undefined,
      getDebug: () => ({ camera, hand, gesture, motion, state, action, detail }),
    };
  }

  const tick = () => {
    if (stopped || !video || !landmarker) return;
    const now = performance.now();
    try {
      const result = landmarker.detectForVideo(video, now);
      const lm = result.landmarks?.[0];
      if (!lm || lm.length < 21) {
        hand = "none";
        gesture = "none";
        if (state === "palm_armed" || state === "grabbed") resetSequence("hand_none");
        else {
          state = "hand_none";
          publish();
        }
      } else {
        hand = "detected";
        const points = lm.map((p) => ({ x: p.x, y: p.y }));
        const pose = classifyHandPose(points);
        gesture = pose === "none" ? "none" : pose;
        const centroid = handCentroid(points);

        if (state === "idle" || state === "hand_none" || state === "camera") {
          if (pose === "open_palm") {
            if (!palmSince) palmSince = now;
            if (now - palmSince >= PALM_HOLD_MS) {
              state = "palm_armed";
              publish();
            }
          } else {
            palmSince = 0;
            state = "hand_none";
            publish();
          }
        } else if (state === "palm_armed") {
          if (pose === "open_palm") {
            publish();
          } else if (pose === "fist") {
            state = "grabbed";
            fistSince = now;
            grabOrigin = centroid;
            grabAt = now;
            lastCentroid = centroid;
            lastAt = now;
            options.onGrabbed?.(true);
            publish();
          } else if (now - (palmSince || now) > FIST_WINDOW_MS) {
            resetSequence("hand_none");
          } else {
            publish();
          }
        } else if (state === "grabbed") {
          if (pose !== "fist") {
            resetSequence("hand_none");
          } else if (grabOrigin) {
            const dt = Math.max(0.016, (now - (lastAt || grabAt)) / 1000);
            const dx = centroid.x - (lastCentroid?.x ?? centroid.x);
            const totalDx = centroid.x - grabOrigin.x;
            const velocity = Math.abs(dx) / dt;
            lastCentroid = centroid;
            lastAt = now;
            const elapsed = now - grabAt;
            if (
              elapsed <= THROW_WINDOW_MS &&
              Math.abs(totalDx) >= THROW_MIN_DX &&
              velocity >= THROW_MIN_VELOCITY &&
              Math.abs(totalDx) > Math.abs(centroid.y - grabOrigin.y)
            ) {
              motion = totalDx < 0 ? "throw_left" : "throw_right";
              state = "throw";
              action = "EXIT_HOME";
              publish();
              options.onExitHome();
              resetSequence("hand_none");
            } else if (elapsed > THROW_WINDOW_MS) {
              resetSequence("hand_none");
            } else {
              publish();
            }
          }
        }
      }
    } catch (error) {
      detail = error instanceof Error ? error.message : "detect_failed";
      publish();
    }
    raf = window.requestAnimationFrame(tick);
  };
  const onVisibility = () => {
    if (stopped) return;
    if (document.visibilityState === "hidden") {
      window.cancelAnimationFrame(raf);
      raf = 0;
      stream?.getTracks().forEach((track) => {
        track.enabled = false;
      });
      if (video) video.pause();
      camera = "off";
      state = "idle";
      detail = "suspended";
      options.onGrabbed?.(false);
      publish();
      return;
    }
    stream?.getTracks().forEach((track) => {
      track.enabled = true;
    });
    if (video) {
      void video.play().catch(() => undefined);
    }
    camera = "ready";
    state = "hand_none";
    detail = "";
    publish();
    if (!raf) raf = window.requestAnimationFrame(tick);
  };
  document.addEventListener("visibilitychange", onVisibility);

  raf = window.requestAnimationFrame(tick);

  return {
    stop: () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisibility);
      window.cancelAnimationFrame(raf);
      raf = 0;
      options.onGrabbed?.(false);
      try {
        landmarker?.close?.();
      } catch {
        /* ignore */
      }
      landmarker = null;
      if (video) {
        video.pause();
        video.srcObject = null;
        video = null;
      }
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      camera = "off";
      state = "idle";
      publish();
    },
    getDebug: () => ({ camera, hand, gesture, motion, state, action, detail }),
  };
}
