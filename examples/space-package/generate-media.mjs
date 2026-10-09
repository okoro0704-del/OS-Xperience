// Regenerates the synthetic demo media deterministically (no third-party content).
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const out = Buffer.alloc(12 + data.length); out.writeUInt32BE(data.length, 0); out.write(type, 4, "ascii"); data.copy(out, 8); out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length); return out; };

// 32×32 lantern-glow PNG (RGB).
const size = 32;
const rows = [];
for (let y = 0; y < size; y += 1) {
  const row = Buffer.alloc(1 + size * 3);
  for (let x = 0; x < size; x += 1) {
    const d = Math.hypot(x - 15.5, y - 15.5) / 22;
    const glow = Math.max(0, 1 - d);
    row[1 + x * 3] = Math.round(20 + 235 * glow);
    row[2 + x * 3] = Math.round(15 + 170 * glow * glow);
    row[3 + x * 3] = Math.round(40 + 30 * (1 - glow));
  }
  rows.push(row);
}
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
writeFileSync("lantern/content/media/lantern.png", Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows), { level: 9 })), chunk("IEND", Buffer.alloc(0))]));

// 0.5 s, 8 kHz, 8-bit mono WAV: a soft 440 Hz chime with decay.
const rate = 8000, samples = rate / 2;
const wav = Buffer.alloc(44 + samples);
wav.write("RIFF", 0); wav.writeUInt32LE(36 + samples, 4); wav.write("WAVE", 8); wav.write("fmt ", 12);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate, 28); wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34);
wav.write("data", 36); wav.writeUInt32LE(samples, 40);
for (let i = 0; i < samples; i += 1) wav[44 + i] = 128 + Math.round(90 * Math.exp(-i / 1400) * Math.sin((2 * Math.PI * 440 * i) / rate));
writeFileSync("lantern/content/media/chime.wav", wav);
console.log("wrote lantern.png and chime.wav");
