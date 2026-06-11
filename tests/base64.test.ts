import { describe, expect, it } from 'vitest';
import { arrayBufferToBase64 } from '../src/utils/base64';

describe('arrayBufferToBase64', () => {
  it('encodes empty buffer to empty string', () => {
    const buffer = new Uint8Array([]).buffer;
    expect(arrayBufferToBase64(buffer)).toBe('');
  });

  it('encodes single byte correctly', () => {
    const buffer = new Uint8Array([0xff]).buffer;
    expect(arrayBufferToBase64(buffer)).toBe('/w==');
  });

  it('encodes two bytes correctly', () => {
    const buffer = new Uint8Array([0xff, 0xee]).buffer;
    expect(arrayBufferToBase64(buffer)).toBe('/+4=');
  });

  it('encodes three bytes correctly', () => {
    const buffer = new Uint8Array([0xff, 0xee, 0xdd]).buffer;
    expect(arrayBufferToBase64(buffer)).toBe('/+7d');
  });

  it('encodes string buffer correctly', () => {
    const encoder = new TextEncoder();
    const buffer = encoder.encode('hello').buffer;
    expect(arrayBufferToBase64(buffer)).toBe('aGVsbG8=');
  });
});
