// Generate a cute pet icon for the ShanHaiLing desktop pet app
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 256;

// Create pixel buffer (RGBA)
const pixels = Buffer.alloc(SIZE * SIZE * 4);

function setPixel(x, y, r, g, b, a = 255) {
  if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return;
  const idx = (y * SIZE + x) * 4;
  pixels[idx] = r;
  pixels[idx + 1] = g;
  pixels[idx + 2] = b;
  pixels[idx + 3] = a;
}

function fillCircle(cx, cy, radius, r, g, b, a = 255) {
  for (let y = Math.max(0, Math.floor(cy - radius)); y < Math.min(SIZE, Math.ceil(cy + radius)); y++) {
    for (let x = Math.max(0, Math.floor(cx - radius)); x < Math.min(SIZE, Math.ceil(cx + radius)); x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= radius * radius) {
        const idx = (y * SIZE + x) * 4;
        // Alpha blending for smooth edges
        const dist = Math.sqrt(dx * dx + dy * dy);
        const edge = radius * 0.85;
        let alpha = a;
        if (dist > edge) {
          alpha = Math.max(0, Math.round(a * (1 - (dist - edge) / (radius - edge))));
        }
        if (pixels[idx + 3] < alpha) {
          pixels[idx] = r;
          pixels[idx + 1] = g;
          pixels[idx + 2] = b;
          pixels[idx + 3] = alpha;
        }
      }
    }
  }
}

// Background - transparent rounded square with soft gradient
const c = SIZE / 2;
const bgR = SIZE * 0.46;

// Soft gradient background
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const dx = x - c, dy = y - c;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < bgR) {
      const t = dist / bgR;
      const r = Math.round(255 * (1 - t * 0.3));
      const g = Math.round(180 * (1 - t * 0.3));
      const b = Math.round(100 * (1 - t * 0.2));
      const edge = bgR * 0.88;
      let alpha = 255;
      if (dist > edge) {
        alpha = Math.max(0, Math.round(255 * (1 - (dist - edge) / (bgR - edge))));
      }
      setPixel(x, y, r, g, b, alpha);
    }
  }
}

// Face - cream/white circle
fillCircle(c, c + 10, SIZE * 0.38, 255, 245, 230);

// Left ear
fillCircle(c - 72, c - 30, 52, 200, 140, 80);
fillCircle(c - 72, c - 28, 38, 240, 180, 130);
fillCircle(c - 72, c - 25, 28, 255, 220, 180);

// Right ear
fillCircle(c + 72, c - 30, 52, 200, 140, 80);
fillCircle(c + 72, c - 28, 38, 240, 180, 130);
fillCircle(c + 72, c - 25, 28, 255, 220, 180);

// Eyes
fillCircle(c - 48, c + 2, 22, 255, 255, 255); // eye white
fillCircle(c - 48, c + 2, 14, 50, 30, 20);    // pupil
fillCircle(c - 44, c - 4, 6, 255, 255, 255);  // highlight

fillCircle(c + 48, c + 2, 22, 255, 255, 255); // eye white
fillCircle(c + 48, c + 2, 14, 50, 30, 20);    // pupil
fillCircle(c + 44, c - 4, 6, 255, 255, 255);  // highlight

// Nose
fillCircle(c, c + 32, 16, 60, 35, 25);
fillCircle(c - 4, c + 28, 5, 80, 50, 35);

// Mouth - happy smile
for (let x = -30; x <= 30; x++) {
  const y = c + 55 + (x * x) / 35;
  if (y < SIZE) {
    for (let dy = -2; dy <= 2; dy++) {
      setPixel(Math.round(c + x), Math.round(y + dy), 60, 35, 25);
    }
  }
}

// Blush
fillCircle(c - 68, c + 30, 18, 255, 160, 160, 120);
fillCircle(c + 68, c + 30, 18, 255, 160, 160, 120);

// ── Build PNG ──────────────────────────────────────────

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  const table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c;
  }
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function makeChunk(type, data) {
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([len, typeAndData, crc]);
}

// PNG Signature
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// IHDR
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);    // width
ihdr.writeUInt32BE(SIZE, 4);    // height
ihdr[8] = 8;                     // bit depth
ihdr[9] = 6;                     // color type (RGBA)
ihdr[10] = 0;                    // compression
ihdr[11] = 0;                    // filter
ihdr[12] = 0;                    // interlace

// IDAT - filter + compress pixel data
const filtered = Buffer.alloc(SIZE * SIZE * 4 + SIZE); // +1 filter byte per row
for (let y = 0; y < SIZE; y++) {
  filtered[y * (SIZE * 4 + 1)] = 0; // filter: None
  pixels.copy(filtered, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}

const compressed = zlib.deflateSync(filtered, { level: 9 });

const png = Buffer.concat([
  signature,
  makeChunk('IHDR', ihdr),
  makeChunk('IDAT', compressed),
  makeChunk('IEND', Buffer.alloc(0))
]);

// Write PNG
const pngPath = path.join(__dirname, '..', 'icon.png');
fs.writeFileSync(pngPath, png);
console.log(`Generated: ${pngPath}`);

// ── Build ICO (wrap PNG) ───────────────────────────────
const icoHeader = Buffer.alloc(6);
icoHeader.writeUInt16LE(0, 0);   // reserved
icoHeader.writeUInt16LE(1, 2);   // type: ICO
icoHeader.writeUInt16LE(1, 4);   // count: 1

const icoEntry = Buffer.alloc(16);
icoEntry.writeUInt8(SIZE >= 256 ? 0 : SIZE, 0);  // width (0 = 256)
icoEntry.writeUInt8(SIZE >= 256 ? 0 : SIZE, 1);  // height (0 = 256)
icoEntry.writeUInt8(0, 2);                     // color palette
icoEntry.writeUInt8(0, 3);                     // reserved
icoEntry.writeUInt16LE(1, 4);                  // color planes
icoEntry.writeUInt16LE(32, 6);                 // bits per pixel
icoEntry.writeUInt32LE(png.length, 8);         // image size
icoEntry.writeUInt32LE(22, 12);                // offset (6 header + 16 entry)

const icoPath = path.join(__dirname, '..', 'icon.ico');
fs.writeFileSync(icoPath, Buffer.concat([icoHeader, icoEntry, png]));
console.log(`Generated: ${icoPath}`);
console.log('Icon generation complete!');
