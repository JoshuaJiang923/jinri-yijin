const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const sizes = [180, 192, 512];
const outDir = __dirname;

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function mix(a, b, amount) {
  return Math.round(a + (b - a) * amount);
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared)) : 0;
  const x = ax + t * dx;
  const y = ay + t * dy;
  return Math.hypot(px - x, py - y);
}

function sampleColor(x, y) {
  const margin = 0.045;
  const radius = 0.22;
  const qx = Math.abs(x - 0.5) - (0.5 - margin - radius);
  const qy = Math.abs(y - 0.5) - (0.5 - margin - radius);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - radius;
  const insideRoundedRect =
    outside < 0 && x > margin && x < 1 - margin && y > margin && y < 1 - margin;
  if (!insideRoundedRect) return [0, 0, 0, 0];

  let color = [23, 63, 53, 255];
  const ringDistance = Math.abs(Math.hypot(x - 0.5, y - 0.5) - 0.305);
  if (ringDistance < 0.018) {
    color = [mix(color[0], 243, 0.28), mix(color[1], 239, 0.28), mix(color[2], 229, 0.28), 255];
  }

  const lineWidth = 0.044;
  const checkDistance = Math.min(
    distanceToSegment(x, y, 0.33, 0.52, 0.46, 0.64),
    distanceToSegment(x, y, 0.46, 0.64, 0.69, 0.38),
  );
  if (checkDistance < lineWidth) color = [240, 154, 81, 255];

  if (Math.hypot(x - 0.73, y - 0.29) < 0.047) color = [243, 239, 229, 255];
  return color;
}

function renderPng(size) {
  const rows = [];
  const samples = 3;
  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(1 + size * 4);
    row[0] = 0;
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const px = (x + (sx + 0.5) / samples) / size;
          const py = (y + (sy + 0.5) / samples) / size;
          const color = sampleColor(px, py);
          r += color[0];
          g += color[1];
          b += color[2];
          a += color[3];
        }
      }
      const count = samples * samples;
      const offset = 1 + x * 4;
      row[offset] = Math.round(r / count);
      row[offset + 1] = Math.round(g / count);
      row[offset + 2] = Math.round(b / count);
      row[offset + 3] = Math.round(a / count);
    }
    rows.push(row);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(Buffer.concat(rows), { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const size of sizes) {
  const target = path.join(outDir, `icon-${size}.png`);
  fs.writeFileSync(target, renderPng(size));
  console.log(`generated ${target}`);
}
