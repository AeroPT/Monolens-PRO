/**
 * Adobe DNG (Digital Negative 1.4.0.0) / TIFF-EP Binary Encoder
 *
 * Produces a Google Pixel / Android SkRawCodec (libdng_sdk) compatible DNG:
 * - IFD0: Reduced-resolution 8-bit RGB preview thumbnail + SubIFDs pointer + DNG camera/color tags + ExifIFD
 * - SubIFD0: Full-resolution 16-bit RGGB Bayer CFA (PhotometricInterpretation = 32803) with linear light LUT,
 *   multi-strip layout, BlackLevel/WhiteLevel, ActiveArea, DefaultCropOrigin, and DefaultCropSize.
 */

export interface DngMetadata {
  exposureTimeSeconds?: number;
  iso?: number;
  timestamp?: number;
  make?: string;
  model?: string;
}

const formatExifDate = (ts: number): string => {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}:${pad(d.getMonth() + 1)}:${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const toAsciiBytes = (str: string): Uint8Array => {
  const bytes = new Uint8Array(str.length + 1);
  for (let i = 0; i < str.length; i++) {
    bytes[i] = str.charCodeAt(i) & 0x7f;
  }
  bytes[str.length] = 0;
  return bytes;
};

const packShorts = (...vals: number[]): Uint8Array => {
  const buf = new Uint8Array(vals.length * 2);
  const v = new DataView(buf.buffer);
  for (let i = 0; i < vals.length; i++) {
    v.setUint16(i * 2, vals[i], true);
  }
  return buf;
};

const packLongs = (...vals: number[]): Uint8Array => {
  const buf = new Uint8Array(vals.length * 4);
  const v = new DataView(buf.buffer);
  for (let i = 0; i < vals.length; i++) {
    v.setUint32(i * 4, vals[i], true);
  }
  return buf;
};

const packRationals = (pairs: Array<[number, number]>): Uint8Array => {
  const buf = new Uint8Array(pairs.length * 8);
  const v = new DataView(buf.buffer);
  for (let i = 0; i < pairs.length; i++) {
    v.setUint32(i * 8, pairs[i][0] >>> 0, true);
    v.setUint32(i * 8 + 4, pairs[i][1] >>> 0, true);
  }
  return buf;
};

const packSRationals = (pairs: Array<[number, number]>): Uint8Array => {
  const buf = new Uint8Array(pairs.length * 8);
  const v = new DataView(buf.buffer);
  for (let i = 0; i < pairs.length; i++) {
    v.setInt32(i * 8, pairs[i][0] | 0, true);
    v.setInt32(i * 8 + 4, pairs[i][1] | 0, true);
  }
  return buf;
};

// Precomputed sRGB (0..255) -> Linear 16-bit (0..65535) lookup table
const SRGB_TO_LINEAR_16 = new Uint16Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  const lin = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  SRGB_TO_LINEAR_16[i] = Math.max(0, Math.min(65535, Math.round(lin * 65535)));
}

// TIFF Type constants
const TYPE_BYTE = 1;
const TYPE_ASCII = 2;
const TYPE_SHORT = 3;
const TYPE_LONG = 4;
const TYPE_RATIONAL = 5;
const TYPE_UNDEFINED = 7;
const TYPE_SRATIONAL = 10;

interface IfdEntry {
  tag: number;
  type: number;
  count: number;
  inlineValue?: number; // for single SHORT / LONG
  inlineBytes?: Uint8Array; // for <= 4 raw bytes (e.g. DNGVersion, CFAPattern)
  dataBytes?: Uint8Array; // for > 4 bytes stored out-of-line
}

export const encodeDngFromImageData = (
  imageData: ImageData,
  meta: DngMetadata = {}
): ArrayBuffer => {
  const { width, height, data } = imageData;

  // 2x2 RGGB Bayer CFA requires even sensor dimensions
  const rawW = Math.max(2, width & ~1);
  const rawH = Math.max(2, height & ~1);

  // Embedded IFD0 thumbnail preview (max 320px long edge, >= 2px)
  const maxThumbEdge = 320;
  const scale = Math.min(1, maxThumbEdge / Math.max(rawW, rawH));
  const thumbW = Math.max(2, Math.round(rawW * scale));
  const thumbH = Math.max(2, Math.round(rawH * scale));
  const thumbByteCount = thumbW * thumbH * 3;

  // Strip partitioning for main raw image (64 rows per strip)
  const rowsPerStrip = Math.min(rawH, 64);
  const stripCount = Math.ceil(rawH / rowsPerStrip);
  const stripByteCountsArr = new Array<number>(stripCount);
  let totalRawBytes = 0;
  for (let s = 0; s < stripCount; s++) {
    const startRow = s * rowsPerStrip;
    const rowsInThisStrip = Math.min(rowsPerStrip, rawH - startRow);
    const bytesInStrip = rowsInThisStrip * rawW * 2; // 16-bit (2 bytes) per Bayer pixel
    stripByteCountsArr[s] = bytesInStrip;
    totalRawBytes += bytesInStrip;
  }

  const makeStr = meta.make ?? 'Google';
  const modelStr = meta.model ?? 'Pixel 7';
  const makeBytes = toAsciiBytes(makeStr);
  const modelBytes = toAsciiBytes(modelStr);
  const uniqueModelBytes = toAsciiBytes(`${makeStr} ${modelStr}`);
  const softwareBytes = toAsciiBytes('MonoLens Pro V3');
  const dateBytes = toAsciiBytes(formatExifDate(meta.timestamp ?? Date.now()));

  const bitsPerSampleRgb = packShorts(8, 8, 8); // 6 bytes
  const res72 = packRationals([[72, 1]]); // 8 bytes

  // ColorMatrix1: CIE XYZ (D65) -> Linear sRGB
  const colorMatrixBytes = packSRationals([
    [32406, 10000], [-15372, 10000], [-4986, 10000],
    [-9693, 10000], [18760, 10000], [416, 10000],
    [556, 10000], [-2040, 10000], [10570, 10000],
  ]);

  const analogBalanceBytes = packRationals([[1, 1], [1, 1], [1, 1]]);
  const asShotNeutralBytes = packRationals([[1, 1], [1, 1], [1, 1]]);
  const baselineExposureBytes = packSRationals([[0, 100]]);
  const oneRationalBytes = packRationals([[1, 1]]);
  const zeroRationalBytes = packRationals([[0, 1]]);
  const defaultScaleBytes = packRationals([[1, 1], [1, 1]]);
  const defaultCropOriginBytes = packLongs(0, 0);
  const defaultCropSizeBytes = packLongs(rawW, rawH);
  const activeAreaBytes = packLongs(0, 0, rawH, rawW); // top, left, bottom, right

  // Exif ExposureTime RATIONAL
  const expSeconds = Math.max(0.0001, meta.exposureTimeSeconds ?? 1 / 125);
  const expBytes =
    expSeconds >= 1
      ? packRationals([[Math.round(expSeconds * 1000), 1000]])
      : packRationals([[1, Math.max(1, Math.round(1 / expSeconds))]]);
  const isoVal = Math.max(25, Math.min(65535, Math.round(meta.iso ?? 200)));

  // Exif SubIFD (strictly ascending tag order)
  const exifEntries: IfdEntry[] = [
    { tag: 0x829a, type: TYPE_RATIONAL, count: 1, dataBytes: expBytes },
    { tag: 0x8827, type: TYPE_SHORT, count: 1, inlineValue: isoVal },
    {
      tag: 0x9000,
      type: TYPE_UNDEFINED,
      count: 4,
      inlineBytes: new Uint8Array([0x30, 0x32, 0x33, 0x31]), // "0231"
    },
    { tag: 0x9003, type: TYPE_ASCII, count: dateBytes.length, dataBytes: dateBytes },
    { tag: 0x9004, type: TYPE_ASCII, count: dateBytes.length, dataBytes: dateBytes },
  ];

  // Dynamic pointer placeholders
  const thumbStripOffsetEntry: IfdEntry = {
    tag: 0x0111,
    type: TYPE_LONG,
    count: 1,
    inlineValue: 0,
  };
  const subIfdsPtrEntry: IfdEntry = {
    tag: 0x014a,
    type: TYPE_LONG,
    count: 1,
    inlineValue: 0,
  };
  const exifPtrEntry: IfdEntry = {
    tag: 0x8769,
    type: TYPE_LONG,
    count: 1,
    inlineValue: 0,
  };

  // IFD0: Reduced-resolution RGB preview + global DNG calibration & metadata (strictly ascending tag order)
  const ifd0Entries: IfdEntry[] = [
    { tag: 0x00fe, type: TYPE_LONG, count: 1, inlineValue: 1 }, // NewSubfileType: Reduced preview
    { tag: 0x0100, type: TYPE_LONG, count: 1, inlineValue: thumbW },
    { tag: 0x0101, type: TYPE_LONG, count: 1, inlineValue: thumbH },
    { tag: 0x0102, type: TYPE_SHORT, count: 3, dataBytes: bitsPerSampleRgb },
    { tag: 0x0103, type: TYPE_SHORT, count: 1, inlineValue: 1 }, // Uncompressed
    { tag: 0x0106, type: TYPE_SHORT, count: 1, inlineValue: 2 }, // RGB preview
    { tag: 0x010f, type: TYPE_ASCII, count: makeBytes.length, dataBytes: makeBytes },
    { tag: 0x0110, type: TYPE_ASCII, count: modelBytes.length, dataBytes: modelBytes },
    thumbStripOffsetEntry, // 0x0111
    { tag: 0x0112, type: TYPE_SHORT, count: 1, inlineValue: 1 }, // Orientation: Top-Left
    { tag: 0x0115, type: TYPE_SHORT, count: 1, inlineValue: 3 },
    { tag: 0x0116, type: TYPE_LONG, count: 1, inlineValue: thumbH },
    { tag: 0x0117, type: TYPE_LONG, count: 1, inlineValue: thumbByteCount },
    { tag: 0x011a, type: TYPE_RATIONAL, count: 1, dataBytes: res72 },
    { tag: 0x011b, type: TYPE_RATIONAL, count: 1, dataBytes: res72 },
    { tag: 0x011c, type: TYPE_SHORT, count: 1, inlineValue: 1 }, // Chunky
    { tag: 0x0128, type: TYPE_SHORT, count: 1, inlineValue: 2 }, // Inches
    { tag: 0x0131, type: TYPE_ASCII, count: softwareBytes.length, dataBytes: softwareBytes },
    { tag: 0x0132, type: TYPE_ASCII, count: dateBytes.length, dataBytes: dateBytes },
    subIfdsPtrEntry, // 0x014A SubIFDs
    exifPtrEntry, // 0x8769 ExifIFDPointer
    {
      tag: 0xc612,
      type: TYPE_BYTE,
      count: 4,
      inlineBytes: new Uint8Array([1, 4, 0, 0]),
    }, // DNGVersion 1.4.0.0
    {
      tag: 0xc613,
      type: TYPE_BYTE,
      count: 4,
      inlineBytes: new Uint8Array([1, 1, 0, 0]),
    }, // DNGBackwardVersion 1.1.0.0
    {
      tag: 0xc614,
      type: TYPE_ASCII,
      count: uniqueModelBytes.length,
      dataBytes: uniqueModelBytes,
    },
    { tag: 0xc621, type: TYPE_SRATIONAL, count: 9, dataBytes: colorMatrixBytes },
    { tag: 0xc627, type: TYPE_RATIONAL, count: 3, dataBytes: analogBalanceBytes },
    { tag: 0xc628, type: TYPE_RATIONAL, count: 3, dataBytes: asShotNeutralBytes },
    { tag: 0xc62a, type: TYPE_SRATIONAL, count: 1, dataBytes: baselineExposureBytes },
    { tag: 0xc62b, type: TYPE_RATIONAL, count: 1, dataBytes: oneRationalBytes },
    { tag: 0xc62c, type: TYPE_RATIONAL, count: 1, dataBytes: oneRationalBytes },
    { tag: 0xc62e, type: TYPE_RATIONAL, count: 1, dataBytes: oneRationalBytes },
    { tag: 0xc65a, type: TYPE_SHORT, count: 1, inlineValue: 21 }, // D65
  ];

  // Raw strip offset/byteCount entries (inline if stripCount === 1, out-of-line otherwise)
  const rawStripOffsetsEntry: IfdEntry =
    stripCount === 1
      ? { tag: 0x0111, type: TYPE_LONG, count: 1, inlineValue: 0 }
      : {
          tag: 0x0111,
          type: TYPE_LONG,
          count: stripCount,
          dataBytes: new Uint8Array(stripCount * 4),
        };

  const rawStripByteCountsEntry: IfdEntry =
    stripCount === 1
      ? { tag: 0x0117, type: TYPE_LONG, count: 1, inlineValue: stripByteCountsArr[0] }
      : {
          tag: 0x0117,
          type: TYPE_LONG,
          count: stripCount,
          dataBytes: packLongs(...stripByteCountsArr),
        };

  // SubIFD0: Main 16-bit RGGB Bayer CFA Image (strictly ascending tag order)
  const subIfd0Entries: IfdEntry[] = [
    { tag: 0x00fe, type: TYPE_LONG, count: 1, inlineValue: 0 }, // NewSubfileType: Primary Raw
    { tag: 0x0100, type: TYPE_LONG, count: 1, inlineValue: rawW },
    { tag: 0x0101, type: TYPE_LONG, count: 1, inlineValue: rawH },
    { tag: 0x0102, type: TYPE_SHORT, count: 1, inlineValue: 16 }, // 16-bit per Bayer pixel
    { tag: 0x0103, type: TYPE_SHORT, count: 1, inlineValue: 1 }, // Uncompressed
    { tag: 0x0106, type: TYPE_SHORT, count: 1, inlineValue: 32803 }, // CFA (piCFA)
    rawStripOffsetsEntry, // 0x0111
    { tag: 0x0115, type: TYPE_SHORT, count: 1, inlineValue: 1 }, // SamplesPerPixel
    { tag: 0x0116, type: TYPE_LONG, count: 1, inlineValue: rowsPerStrip },
    rawStripByteCountsEntry, // 0x0117
    { tag: 0x011c, type: TYPE_SHORT, count: 1, inlineValue: 1 }, // PlanarConfiguration
    { tag: 0x0153, type: TYPE_SHORT, count: 1, inlineValue: 1 }, // SampleFormat: Unsigned int
    {
      tag: 0x828d,
      type: TYPE_SHORT,
      count: 2,
      inlineBytes: packShorts(2, 2),
    }, // CFARepeatPatternDim [2, 2]
    {
      tag: 0x828e,
      type: TYPE_BYTE,
      count: 4,
      inlineBytes: new Uint8Array([0, 1, 1, 2]), // RGGB
    }, // CFAPattern
    {
      tag: 0xc616,
      type: TYPE_BYTE,
      count: 3,
      inlineBytes: new Uint8Array([0, 1, 2, 0]),
    }, // CFAPlaneColor [R, G, B]
    { tag: 0xc617, type: TYPE_SHORT, count: 1, inlineValue: 1 }, // CFALayout: Rectangular
    {
      tag: 0xc619,
      type: TYPE_SHORT,
      count: 2,
      inlineBytes: packShorts(1, 1),
    }, // BlackLevelRepeatDim [1, 1]
    { tag: 0xc61a, type: TYPE_RATIONAL, count: 1, dataBytes: zeroRationalBytes }, // BlackLevel: 0
    { tag: 0xc61d, type: TYPE_LONG, count: 1, inlineValue: 65535 }, // WhiteLevel: 65535
    { tag: 0xc61e, type: TYPE_RATIONAL, count: 2, dataBytes: defaultScaleBytes },
    { tag: 0xc61f, type: TYPE_LONG, count: 2, dataBytes: defaultCropOriginBytes },
    { tag: 0xc620, type: TYPE_LONG, count: 2, dataBytes: defaultCropSizeBytes },
    { tag: 0xc68d, type: TYPE_LONG, count: 4, dataBytes: activeAreaBytes },
  ];

  // Layout offsets (all structures word-aligned to even bytes)
  const align2 = (n: number) => (n % 2 === 0 ? n : n + 1);
  const headerSize = 8;

  const ifd0Offset = headerSize;
  const ifd0Size = 2 + ifd0Entries.length * 12 + 4;

  const subIfd0Offset = align2(ifd0Offset + ifd0Size);
  const subIfd0Size = 2 + subIfd0Entries.length * 12 + 4;
  subIfdsPtrEntry.inlineValue = subIfd0Offset;

  const exifIfdOffset = align2(subIfd0Offset + subIfd0Size);
  const exifIfdSize = 2 + exifEntries.length * 12 + 4;
  exifPtrEntry.inlineValue = exifIfdOffset;

  let cursor = align2(exifIfdOffset + exifIfdSize);

  const assignDataOffsets = (entries: IfdEntry[]) => {
    const allocations: Array<{ offset: number; bytes: Uint8Array }> = [];
    for (const entry of entries) {
      if (entry.dataBytes) {
        allocations.push({ offset: cursor, bytes: entry.dataBytes });
        entry.inlineValue = cursor;
        cursor += align2(entry.dataBytes.length);
      }
    }
    return allocations;
  };

  const ifd0Allocations = assignDataOffsets(ifd0Entries);
  const subIfd0Allocations = assignDataOffsets(subIfd0Entries);
  const exifAllocations = assignDataOffsets(exifEntries);

  const thumbPixelOffset = align2(cursor);
  thumbStripOffsetEntry.inlineValue = thumbPixelOffset;

  const rawPixelOffset = align2(thumbPixelOffset + thumbByteCount);

  // Populate SubIFD0 strip offsets
  if (stripCount === 1) {
    rawStripOffsetsEntry.inlineValue = rawPixelOffset;
  } else if (rawStripOffsetsEntry.dataBytes) {
    const offView = new DataView(rawStripOffsetsEntry.dataBytes.buffer);
    let runningOffset = rawPixelOffset;
    for (let s = 0; s < stripCount; s++) {
      offView.setUint32(s * 4, runningOffset, true);
      runningOffset += stripByteCountsArr[s];
    }
  }

  const totalSize = rawPixelOffset + totalRawBytes;
  const out = new Uint8Array(totalSize);
  const view = new DataView(out.buffer);

  // 1. TIFF Little-Endian Header ('II', 42, IFD0 offset = 8)
  out[0] = 0x49;
  out[1] = 0x49;
  view.setUint16(2, 42, true);
  view.setUint32(4, ifd0Offset, true);

  // 2. Serialize IFDs
  const writeIfd = (offset: number, entries: IfdEntry[]) => {
    view.setUint16(offset, entries.length, true);
    let pos = offset + 2;
    for (const entry of entries) {
      view.setUint16(pos, entry.tag, true);
      view.setUint16(pos + 2, entry.type, true);
      view.setUint32(pos + 4, entry.count, true);
      if (entry.inlineBytes) {
        out.set(entry.inlineBytes.subarray(0, 4), pos + 8);
      } else if (entry.type === TYPE_SHORT && entry.count === 1 && !entry.dataBytes) {
        view.setUint16(pos + 8, entry.inlineValue ?? 0, true);
        view.setUint16(pos + 10, 0, true);
      } else {
        view.setUint32(pos + 8, entry.inlineValue ?? 0, true);
      }
      pos += 12;
    }
    view.setUint32(pos, 0, true);
  };

  writeIfd(ifd0Offset, ifd0Entries);
  writeIfd(subIfd0Offset, subIfd0Entries);
  writeIfd(exifIfdOffset, exifEntries);

  // 3. Write out-of-line tag payloads
  for (const alloc of ifd0Allocations) out.set(alloc.bytes, alloc.offset);
  for (const alloc of subIfd0Allocations) out.set(alloc.bytes, alloc.offset);
  for (const alloc of exifAllocations) out.set(alloc.bytes, alloc.offset);

  // 4. Write IFD0 8-bit RGB preview thumbnail
  let tDst = thumbPixelOffset;
  for (let ty = 0; ty < thumbH; ty++) {
    const sy = Math.min(rawH - 1, Math.floor((ty * rawH) / thumbH));
    for (let tx = 0; tx < thumbW; tx++) {
      const sx = Math.min(rawW - 1, Math.floor((tx * rawW) / thumbW));
      const srcIdx = (sy * width + sx) * 4;
      out[tDst++] = data[srcIdx];
      out[tDst++] = data[srcIdx + 1];
      out[tDst++] = data[srcIdx + 2];
    }
  }

  // 5. Write SubIFD0 16-bit Linear RGGB Bayer CFA pixels
  let rDst = rawPixelOffset;
  for (let y = 0; y < rawH; y++) {
    const isEvenRow = (y & 1) === 0;
    const rowBase = y * width * 4;
    if (isEvenRow) {
      // Even row: R, G, R, G...
      for (let x = 0; x < rawW; x += 2) {
        const idxR = rowBase + x * 4;
        const valR = SRGB_TO_LINEAR_16[data[idxR]];
        out[rDst++] = valR & 0xff;
        out[rDst++] = valR >> 8;

        const idxG = idxR + 4 + 1;
        const valG = SRGB_TO_LINEAR_16[data[idxG]];
        out[rDst++] = valG & 0xff;
        out[rDst++] = valG >> 8;
      }
    } else {
      // Odd row: G, B, G, B...
      for (let x = 0; x < rawW; x += 2) {
        const idxG = rowBase + x * 4 + 1;
        const valG = SRGB_TO_LINEAR_16[data[idxG]];
        out[rDst++] = valG & 0xff;
        out[rDst++] = valG >> 8;

        const idxB = rowBase + (x + 1) * 4 + 2;
        const valB = SRGB_TO_LINEAR_16[data[idxB]];
        out[rDst++] = valB & 0xff;
        out[rDst++] = valB >> 8;
      }
    }
  }

  return out.buffer;
};

/**
 * Fast, chunk-safe ArrayBuffer -> Base64 encoder for large 12MP+ DNG buffers.
 */
export const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  const len = bytes.length;
  // 12288 is divisible by 3 so intermediate chunks never produce '=' padding
  // and small enough to stay safely under JS argument-spread stack limits.
  const CHUNK_SIZE = 12288;
  const parts: string[] = [];

  for (let i = 0; i < len; i += CHUNK_SIZE) {
    const sub = bytes.subarray(i, Math.min(i + CHUNK_SIZE, len));
    parts.push(String.fromCharCode.apply(null, sub as unknown as number[]));
  }

  return btoa(parts.join(''));
};
