import { arrayBufferToBase64 } from './base64';

export interface OptimizedImageResult {
  ok: boolean;
  mimeType?: string;
  dataBase64?: string;
  originalBytes: number;
  optimizedBytes?: number;
  originalWidth?: number;
  originalHeight?: number;
  optimizedWidth?: number;
  optimizedHeight?: number;
  wasOptimized: boolean;
  warning?: string;
}

export interface ImageOptimizationOptions {
  maxDimension?: number;
  maxBytes?: number;
  quality?: number;
  preferredMimeType?: 'image/jpeg' | 'image/webp';
  originalMimeType?: string;
}

const SUPPORTED_MIME_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const MAX_IMAGE_PIXELS = 4096 * 4096; // 16 Megapixels to prevent OOM/CPU lock

export async function optimizeImageForAi(
  input: ArrayBuffer,
  options?: ImageOptimizationOptions,
): Promise<OptimizedImageResult> {
  const originalBytes = input.byteLength;
  const originalMime = (options?.originalMimeType || '').toLowerCase().trim();

  // 1. Target MIME limit
  if (!SUPPORTED_MIME_TYPES.has(originalMime)) {
    return {
      ok: false,
      originalBytes,
      wasOptimized: false,
      warning: 'MIME type not supported for optimization',
    };
  }

  const maxDimension = options?.maxDimension ?? 1536;
  const maxBytes = options?.maxBytes ?? 1024 * 1024;
  const preferredMime = options?.preferredMimeType ?? 'image/jpeg';
  const initialQuality = options?.quality ?? 0.82;

  let url = '';
  try {
    const blob = new Blob([input], { type: originalMime });
    url = URL.createObjectURL(blob);

    // 2. Decode image and ensure Object URL is revoked
    let img: HTMLImageElement;
    try {
      img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Failed to decode image'));
        image.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
      url = '';
    }

    const originalWidth = img.width;
    const originalHeight = img.height;

    // 3. Huge pixel count check
    if (originalWidth * originalHeight > MAX_IMAGE_PIXELS) {
      return {
        ok: false,
        originalBytes,
        originalWidth,
        originalHeight,
        wasOptimized: false,
        warning: 'exceeded maximum pixel limit',
      };
    }

    // 4. Case A: Already within limits
    if (originalWidth <= maxDimension && originalHeight <= maxDimension && originalBytes <= maxBytes) {
      return {
        ok: true,
        mimeType: originalMime,
        dataBase64: arrayBufferToBase64(input),
        originalBytes,
        originalWidth,
        originalHeight,
        wasOptimized: false,
      };
    }

    // Determine target dimensions
    let targetWidth = originalWidth;
    let targetHeight = originalHeight;

    if (originalWidth > maxDimension || originalHeight > maxDimension) {
      if (originalWidth > originalHeight) {
        targetHeight = Math.round((originalHeight * maxDimension) / originalWidth);
        targetWidth = maxDimension;
      } else {
        targetWidth = Math.round((originalWidth * maxDimension) / originalHeight);
        targetHeight = maxDimension;
      }
    }

    // Set up canvas — using activeDocument to support popout windows
    const doc = typeof activeDocument !== 'undefined' ? activeDocument : document;
    const canvas = doc.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return {
        ok: false,
        originalBytes,
        wasOptimized: false,
        warning: 'Failed to get 2D canvas context',
      };
    }

    // Flatten transparent background to white if exporting to JPEG
    if (preferredMime === 'image/jpeg') {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, targetWidth, targetHeight);
    }

    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

    // Compress with retry qualities
    const qualities = [initialQuality, 0.72, 0.62];
    let finalBlob: Blob | null = null;

    for (const q of qualities) {
      const b = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(
          (result: Blob | null) => resolve(result),
          preferredMime,
          q,
        );
      });

      if (b && b.size <= maxBytes) {
        finalBlob = b;
        break;
      }

      if (b) {
        finalBlob = b; // Keep fallback
      }
    }

    if (!finalBlob) {
      return {
        ok: false,
        originalBytes,
        wasOptimized: false,
        warning: 'Failed to generate blob from canvas',
      };
    }

    if (finalBlob.size > maxBytes) {
      return {
        ok: false,
        originalBytes,
        optimizedBytes: finalBlob.size,
        originalWidth,
        originalHeight,
        optimizedWidth: targetWidth,
        optimizedHeight: targetHeight,
        wasOptimized: true,
        warning: 'optimization failed to reach target byte size',
      };
    }

    const optimizedBuffer = await finalBlob.arrayBuffer();
    const dataBase64 = arrayBufferToBase64(optimizedBuffer);

    return {
      ok: true,
      mimeType: preferredMime,
      dataBase64,
      originalBytes,
      optimizedBytes: finalBlob.size,
      originalWidth,
      originalHeight,
      optimizedWidth: targetWidth,
      optimizedHeight: targetHeight,
      wasOptimized: true,
    };
  } catch (err) {
    // Make sure we revoke URL if error happens before inner try-finally
    if (url) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // Ignore errors in fallback revoke
      }
    }
    return {
      ok: false,
      originalBytes,
      wasOptimized: false,
      warning: err instanceof Error ? err.message : 'Unknown decoding error',
    };
  }
}


