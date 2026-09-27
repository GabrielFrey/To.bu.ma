import {
  ImageMagick,
  initializeImageMagick,
  MagickFormat,
  type IMagickImage,
} from '@imagemagick/magick-wasm';

import { FunctionError } from './http.ts';

/**
 * WebP encoding happens here rather than on the device: expo-image-manipulator has no
 * WebP output on iOS, and WhatsApp only accepts 512x512 WebP under 100 KB.
 *
 * sharp is not used because Edge Functions run on Deno and sharp needs native Node
 * bindings; magick-wasm is the supported way to do this inside a function.
 */

const WHATSAPP_STICKER_SIZE = 512;
const WHATSAPP_STICKER_MAX_BYTES = 100 * 1024;
const TRAY_SIZE = 96;
const TRAY_MAX_BYTES = 50 * 1024;

let initialized = false;

async function ensureMagick(): Promise<void> {
  if (initialized) return;
  const wasmUrl = new URL('magick.wasm', import.meta.resolve('@imagemagick/magick-wasm'));
  // Locally the package resolves to a file: URL, which fetch cannot read.
  let wasmBytes: Uint8Array<ArrayBuffer>;
  if (wasmUrl.protocol === 'file:') {
    wasmBytes = await Deno.readFile(wasmUrl);
  } else {
    const response = await fetch(wasmUrl);
    wasmBytes = new Uint8Array(await response.arrayBuffer());
  }
  await initializeImageMagick(wasmBytes);
  initialized = true;
}

export interface NormalizedSticker {
  png: Uint8Array;
  webp: Uint8Array;
  tray: Uint8Array;
  width: number;
  height: number;
}

function withImage<T>(input: Uint8Array, callback: (image: IMagickImage) => T): T {
  let result: T | undefined;
  let failure: unknown;
  ImageMagick.read(input, (image) => {
    try {
      result = callback(image);
    } catch (error) {
      failure = error;
    }
  });
  if (failure) throw failure;
  if (result === undefined) {
    throw new FunctionError('invalid_image', 'Could not read the generated image');
  }
  return result;
}

/**
 * Squares the image on a transparent canvas, then encodes the three artefacts the
 * export pipeline needs. Quality is stepped down until the byte budget is met, because
 * WhatsApp rejects the whole pack when a single sticker is too large.
 */
export async function normalizeSticker(input: Uint8Array): Promise<NormalizedSticker> {
  await ensureMagick();

  const squarePng = withImage(input, (image) => {
    image.resize(WHATSAPP_STICKER_SIZE, WHATSAPP_STICKER_SIZE);
    image.extent(
      WHATSAPP_STICKER_SIZE,
      WHATSAPP_STICKER_SIZE,
      // Center the artwork and keep the padding transparent.
      9,
    );
    image.format = MagickFormat.Png;
    return image.write(MagickFormat.Png, (data) => new Uint8Array(data));
  });

  const webp = encodeUnderBudget(squarePng, MagickFormat.WebP, WHATSAPP_STICKER_MAX_BYTES, [
    90, 80, 70, 60, 50, 40,
  ]);

  const tray = withImage(squarePng, (image) => {
    image.resize(TRAY_SIZE, TRAY_SIZE);
    image.quality = 90;
    return image.write(MagickFormat.Png, (data) => new Uint8Array(data));
  });

  const trayUnderBudget =
    tray.byteLength <= TRAY_MAX_BYTES
      ? tray
      : encodeUnderBudget(tray, MagickFormat.Png, TRAY_MAX_BYTES, [80, 60, 40]);

  return {
    png: squarePng,
    webp,
    tray: trayUnderBudget,
    width: WHATSAPP_STICKER_SIZE,
    height: WHATSAPP_STICKER_SIZE,
  };
}

function encodeUnderBudget(
  input: Uint8Array,
  format: MagickFormat,
  maxBytes: number,
  qualities: number[],
): Uint8Array {
  let smallest: Uint8Array | null = null;
  for (const quality of qualities) {
    const encoded = withImage(input, (image) => {
      image.quality = quality;
      return image.write(format, (data) => new Uint8Array(data));
    });
    if (!smallest || encoded.byteLength < smallest.byteLength) {
      smallest = encoded;
    }
    if (encoded.byteLength <= maxBytes) {
      return encoded;
    }
  }
  if (!smallest) {
    throw new FunctionError('invalid_image', 'Encoding produced no output');
  }
  // Still over budget: the caller decides whether that blocks the export.
  console.warn(`encoded image is ${smallest.byteLength} bytes, over the ${maxBytes} budget`);
  return smallest;
}

export async function toPngThumbnail(input: Uint8Array, size: number): Promise<Uint8Array> {
  await ensureMagick();
  return withImage(input, (image) => {
    image.resize(size, size);
    image.format = MagickFormat.Png;
    return image.write(MagickFormat.Png, (data) => new Uint8Array(data));
  });
}

export function base64Encode(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

export function base64Decode(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
