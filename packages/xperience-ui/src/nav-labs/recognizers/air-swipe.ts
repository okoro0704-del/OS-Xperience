import type { AirSwipeConfig, AirSwipeState, Point } from "../types.js";
import { DEFAULT_AIR_SWIPE } from "../labs-store.js";
import { handCentroid } from "../../air-navigation.js";

export interface AirSwipeHud {
  state: AirSwipeState;
  detail?: string;
  dx?: number;
  velocity?: number;
}

export interface AirSwipeController {
  stop: () => void;
}

/** Pure horizontal swipe recognition from centroid samples. */
export function classifyAirSwipe(
  samples: Array<{ t: number; x: number }>,
  config: AirSwipeConfig,
): "left" | "right" | null {
  if (samples.length < 2) return null;
  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  const dt = Math.max(0.016, (last.t - first.t) / 1000);
  const dx = last.x - first.x;
  const velocity = Math.abs(dx) / dt;
  if (Math.abs(dx) < config.minDx || velocity < config.minVelocity) return null;
  return dx < 0 ? "left" : "right";
}

export function startAirSwipe(options: {
  onExitHome: () => void;
  onHud: (hud: AirSwipeHud) => void;
  config?: Partial<AirSwipeConfig>;
}): AirSwipeController {
  const config: AirSwipeConfig = { ...DEFAULT_AIR_SWIPE, ...options.config };
  let stopped = false;
  let raf = 0;
  let stream: MediaStream | null = null;
  let video: HTMLVideoElement | null = null;
  let landmarker: {
    detectForVideo: (
      video: HTMLVideoElement,
      ts: number,
    ) => { landmarks: Array<Array<{ x: number; y: number }>> };
    close?: () => void;
  } | null = null;
  let state: AirSwipeState = "starting";
  const samples: Array<{ t: number; x: number }> = [];
  let onVisibility: (() => void) | null = null;

  const publish = (detail?: string, extra?: Partial<AirSwipeHud>) => {
    options.onHud({ state, detail, ...extra });
  };

  const stopTracks = () => {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    if (video) {
      video.pause();
      video.srcObject = null;
      video = null;
    }
  };

  void (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      });
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") state = "denied";
      else if (name === "NotReadableError" || name === "AbortError") state = "conflict";
      else state = "error";
      publish(error instanceof Error ? error.message : "camera_failed");
      return;
    }

    if (stopped) {
      stopTracks();
      return;
    }

    video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "true");
    video.srcObject = stream;
    try {
      await video.play();
    } catch {
      state = "error";
      publish("video_play_failed");
      stopTracks();
      return;
    }

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
      state = "error";
      publish(error instanceof Error ? error.message : "hand_detector_failed");
      stopTracks();
      return;
    }

    if (stopped) {
      try {
        landmarker?.close?.();
      } catch {
        /* ignore */
      }
      stopTracks();
      return;
    }

    state = "ready";
    publish();

    const tick = () => {
      if (stopped || !video || !landmarker) return;
      const now = performance.now();
      try {
        const result = landmarker.detectForVideo(video, now);
        const lm = result.landmarks?.[0];
        if (!lm || lm.length < 21) {
          state = "no_hand";
          samples.splice(0, samples.length);
          publish();
        } else {
          const centroid: Point = handCentroid(lm.map((p) => ({ x: p.x, y: p.y })));
          samples.push({ t: now, x: centroid.x });
          while (samples.length && now - samples[0]!.t > config.sampleWindowMs) {
            samples.shift();
          }
          state = "tracking";
          const direction = classifyAirSwipe(samples, config);
          const first = samples[0];
          const last = samples[samples.length - 1];
          const dx = first && last ? last.x - first.x : 0;
          const dtSec = first && last ? Math.max(0.016, (last.t - first.t) / 1000) : 1;
          const velocity = Math.abs(dx) / dtSec;
          publish(undefined, { dx, velocity });
          if (direction) {
            state = "recognized";
            publish(direction, { dx, velocity });
            options.onExitHome();
            samples.splice(0, samples.length);
            state = "ready";
          }
        }
      } catch (error) {
        state = "error";
        publish(error instanceof Error ? error.message : "detect_failed");
      }
      raf = window.requestAnimationFrame(tick);
    };

    onVisibility = () => {
      if (stopped) return;
      if (document.visibilityState === "hidden") {
        window.cancelAnimationFrame(raf);
        raf = 0;
        stream?.getTracks().forEach((t) => {
          t.enabled = false;
        });
        video?.pause();
        state = "disabled";
        publish("suspended");
        return;
      }
      stream?.getTracks().forEach((t) => {
        t.enabled = true;
      });
      void video?.play().catch(() => undefined);
      state = "ready";
      publish();
      if (!raf) raf = window.requestAnimationFrame(tick);
    };

    if (stopped) {
      try {
        landmarker?.close?.();
      } catch {
        /* ignore */
      }
      stopTracks();
      return;
    }
    document.addEventListener("visibilitychange", onVisibility);
    raf = window.requestAnimationFrame(tick);
  })();

  return {
    stop: () => {
      stopped = true;
      window.cancelAnimationFrame(raf);
      raf = 0;
      if (onVisibility) {
        document.removeEventListener("visibilitychange", onVisibility);
        onVisibility = null;
      }
      try {
        landmarker?.close?.();
      } catch {
        /* ignore */
      }
      landmarker = null;
      stopTracks();
      state = "disabled";
      publish("stopped");
    },
  };
}
