// Builds the SP2 demonstration sources: Lantern Gallery V1 and V2 (synthetic media only).
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const out = Buffer.alloc(12 + data.length); out.writeUInt32BE(data.length, 0); out.write(type, 4, "ascii"); data.copy(out, 8); out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length); return out; };
function png(path, color) {
  const size = 32, rows = [];
  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x += 1) {
      const glow = Math.max(0, 1 - Math.hypot(x - 15.5, y - 15.5) / 22);
      for (let c = 0; c < 3; c += 1) row[1 + x * 3 + c] = Math.round(color.base[c] + color.peak[c] * glow);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows), { level: 9 })), chunk("IEND", Buffer.alloc(0))]));
}
function wav(path, tones) {
  const rate = 8000, samples = rate / 2, out = Buffer.alloc(44 + samples);
  out.write("RIFF", 0); out.writeUInt32LE(36 + samples, 4); out.write("WAVE", 8); out.write("fmt ", 12);
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22); out.writeUInt32LE(rate, 24); out.writeUInt32LE(rate, 28); out.writeUInt16LE(1, 32); out.writeUInt16LE(8, 34);
  out.write("data", 36); out.writeUInt32LE(samples, 40);
  for (let i = 0; i < samples; i += 1) out[44 + i] = 128 + Math.round(tones.reduce((sum, hz) => sum + (90 / tones.length) * Math.exp(-i / 1400) * Math.sin((2 * Math.PI * hz * i) / rate), 0));
  writeFileSync(path, out);
}
const json = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
const source = (version, description) => ({
  package: { id: "org.digiconomy.demo.lantern", version, name: "Lantern Demo Space", description },
  runtime: { spaceContractVersion: 1, minimumRuntimeVersion: "1.0.0" },
  space: { spaceId: "org.digiconomy.demo.lantern", defaultExperienceId: "gallery", experiences: [{ id: "gallery", title: "Lantern Gallery", type: "gallery", entry: { type: "space.content-index/v1", path: "content/index.json" }, offlinePolicy: "cached", requires: ["content.read", "media.playback"] }] },
  offline: { capabilities: ["space.gallery"], contentIndex: "content/index.json" },
  permissions: ["content.read", "media.playback", "network.sync"],
  dependencies: [],
  license: { spdx: "CC0-1.0", duplication: "ALLOWED", redistribution: true },
  provenance: { createdAt: "2026-10-10T00:00:00.000Z", tool: "space-package/2.0.0" },
});

for (const v of ["v1", "v2"]) mkdirSync(`lantern-releases/${v}/content/media`, { recursive: true });
// V1: the original image and chime, and an initial creator playlist.
copyFileSync("lantern/content/media/lantern.png", "lantern-releases/v1/content/media/lantern.png");
copyFileSync("lantern/content/media/chime.wav", "lantern-releases/v1/content/media/chime.wav");
json("lantern-releases/v1/content/index.json", { format: "space.content-index/v1", title: "Lantern Gallery", items: [
  { id: "lantern", title: "Lantern glow", asset: "content/media/lantern.png", kind: "image" },
  { id: "chime", title: "Evening chime", asset: "content/media/chime.wav", kind: "audio" }] });
json("lantern-releases/v1/content/playlist.json", { title: "Evening", items: ["lantern", "chime"] });
json("lantern-releases/v1/space.source.json", source("1.0.0", "Lantern Gallery V1: the original lantern and an evening chime."));
// V2: an updated image (dawn glow), an additional audio piece, and an updated playlist.
png("lantern-releases/v2/content/media/lantern.png", { base: [30, 25, 60], peak: [225, 140, 120] });
copyFileSync("lantern/content/media/chime.wav", "lantern-releases/v2/content/media/chime.wav");
wav("lantern-releases/v2/content/media/bells.wav", [523, 659, 784]);
json("lantern-releases/v2/content/index.json", { format: "space.content-index/v1", title: "Lantern Gallery", items: [
  { id: "lantern", title: "Lantern at dawn", asset: "content/media/lantern.png", kind: "image" },
  { id: "chime", title: "Evening chime", asset: "content/media/chime.wav", kind: "audio" },
  { id: "bells", title: "Morning bells", asset: "content/media/bells.wav", kind: "audio" }] });
json("lantern-releases/v2/content/playlist.json", { title: "Dawn to dusk", items: ["lantern", "bells", "chime"] });
json("lantern-releases/v2/space.source.json", source("2.0.0", "Lantern Gallery V2: a dawn lantern, morning bells and a fuller playlist."));
console.log("wrote lantern-releases/v1 and v2");
