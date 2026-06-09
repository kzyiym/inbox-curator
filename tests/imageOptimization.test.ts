import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { optimizeImageForAi } from '../src/utils/imageOptimization';

class MockImage {
  onload: () => void = () => {};
  onerror: (e: any) => void = () => {};
  _src = '';
  static width = 3000;
  static height = 2000;

  get src() {
    return this._src;
  }

  set src(val: string) {
    this._src = val;
    setTimeout(() => {
      if (val.includes('corrupt')) {
        this.onerror(new Error('Decode failed'));
      } else {
        this.onload();
      }
    }, 0);
  }

  get width() {
    return MockImage.width;
  }

  get height() {
    return MockImage.height;
  }
}

const fillRectSpy = vi.fn();
let fillStyleValue = '';

const mockCanvas = {
  width: 0,
  height: 0,
  getContext: () => ({
    fillRect: fillRectSpy,
    drawImage: () => {},
    get fillStyle() {
      return fillStyleValue;
    },
    set fillStyle(val: string) {
      fillStyleValue = val;
    },
  }),
  toBlob: (callback: (blob: Blob | null) => void, type: string, quality: number) => {
    let size = 500 * 1024; // 500KB
    if (quality === 0.82) {
      size = 1.2 * 1024 * 1024; // 1.2MB (over limit)
    } else if (quality === 0.72) {
      size = 900 * 1024; // 900KB (within limit)
    }
    const blob = new Blob([new ArrayBuffer(size)], { type });
    callback(blob);
  },
};

const originalImage = global.Image;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;
const originalCreateElement = document.createElement;

describe('optimizeImageForAi', () => {
  beforeEach(() => {
    global.Image = MockImage as any;
    URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
    URL.revokeObjectURL = vi.fn();
    document.createElement = vi.fn().mockImplementation((tag) => {
      if (tag === 'canvas') {
        return mockCanvas as any;
      }
      return originalCreateElement.call(document, tag);
    });

    // Reset default dimensions & spies
    MockImage.width = 3000;
    MockImage.height = 2000;
    fillRectSpy.mockClear();
    fillStyleValue = '';
  });

  afterEach(() => {
    global.Image = originalImage;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    document.createElement = originalCreateElement;
    vi.restoreAllMocks();
  });

  it('rejects unsupported MIME types immediately', async () => {
    const input = new ArrayBuffer(100);
    const result = await optimizeImageForAi(input, { originalMimeType: 'image/gif' });

    expect(result.ok).toBe(false);
    expect(result.wasOptimized).toBe(false);
    expect(result.warning).toBe('MIME type not supported for optimization');
  });

  it('skips optimization (Case A) if image is already small and under size limit', async () => {
    MockImage.width = 800;
    MockImage.height = 600;

    const input = new ArrayBuffer(100 * 1024); // 100KB
    const result = await optimizeImageForAi(input, { originalMimeType: 'image/png' });

    expect(result.ok).toBe(true);
    expect(result.wasOptimized).toBe(false);
    expect(result.mimeType).toBe('image/png');
    expect(result.dataBase64).toBeDefined();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  it('resizes proportionally when dimensions are too large', async () => {
    MockImage.width = 3000;
    MockImage.height = 2000;

    const input = new ArrayBuffer(50 * 1024);
    const result = await optimizeImageForAi(input, { originalMimeType: 'image/jpeg' });

    expect(result.ok).toBe(true);
    expect(result.wasOptimized).toBe(true);
    expect(result.optimizedWidth).toBe(1536);
    expect(result.optimizedHeight).toBe(1024);
    expect(result.mimeType).toBe('image/jpeg');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  it('retries with lower quality when output is too large', async () => {
    MockImage.width = 3000;
    MockImage.height = 2000;

    const input = new ArrayBuffer(2 * 1024 * 1024); // 2MB
    const result = await optimizeImageForAi(input, { originalMimeType: 'image/png' });

    expect(result.ok).toBe(true);
    expect(result.wasOptimized).toBe(true);
    // Should have backed off to 0.72 quality which yields 900KB
    expect(result.optimizedBytes).toBe(900 * 1024);
  });

  it('aborts optimization and reports warning if image has huge pixel count', async () => {
    MockImage.width = 5000;
    MockImage.height = 4000; // 20 Megapixels

    const input = new ArrayBuffer(500 * 1024);
    const result = await optimizeImageForAi(input, { originalMimeType: 'image/webp' });

    expect(result.ok).toBe(false);
    expect(result.wasOptimized).toBe(false);
    expect(result.warning).toBe('exceeded maximum pixel limit');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  it('fails safely when image decoding throws error', async () => {
    const input = new ArrayBuffer(5);
    URL.createObjectURL = vi.fn().mockReturnValue('blob:corrupt-url');

    const result = await optimizeImageForAi(input, { originalMimeType: 'image/jpeg' });

    expect(result.ok).toBe(false);
    expect(result.wasOptimized).toBe(false);
    expect(result.warning).toBe('Failed to decode image');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:corrupt-url');
  });

  it('flattens transparent PNG/WebP background to white when converting to JPEG', async () => {
    MockImage.width = 3000;
    MockImage.height = 2000;

    const input = new ArrayBuffer(50 * 1024);
    await optimizeImageForAi(input, {
      originalMimeType: 'image/png',
      preferredMimeType: 'image/jpeg',
    });

    expect(fillRectSpy).toHaveBeenCalled();
    expect(fillStyleValue).toBe('#FFFFFF');
  });

  it('optimizes WebP image and preserves dimensions proportionally', async () => {
    MockImage.width = 2000;
    MockImage.height = 4000;

    const input = new ArrayBuffer(50 * 1024);
    const result = await optimizeImageForAi(input, {
      originalMimeType: 'image/webp',
    });

    expect(result.ok).toBe(true);
    expect(result.wasOptimized).toBe(true);
    expect(result.optimizedWidth).toBe(768);
    expect(result.optimizedHeight).toBe(1536);
  });
});
