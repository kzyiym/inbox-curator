/**
 * ArrayBuffer を Base64 文字列へ変換する。
 * ブラウザ/Node.js 固有APIに依存しない純粋な TypeScript 実装。
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const bytes = new Uint8Array(buffer);
  const result: string[] = [];
  const l = bytes.length;
  for (let i = 0; i < l; i += 3) {
    const c1 = bytes[i];
    const c2 = i + 1 < l ? bytes[i + 1] : NaN;
    const c3 = i + 2 < l ? bytes[i + 2] : NaN;

    const byte1 = c1 >> 2;
    const byte2 = ((c1 & 3) << 4) | (isNaN(c2) ? 0 : c2 >> 4);
    const byte3 = isNaN(c2) ? 64 : ((c2 & 15) << 2) | (isNaN(c3) ? 0 : c3 >> 6);
    const byte4 = isNaN(c3) ? 64 : c3 & 63;

    result.push(
      chars.charAt(byte1) +
      chars.charAt(byte2) +
      (byte3 === 64 ? '=' : chars.charAt(byte3)) +
      (byte4 === 64 ? '=' : chars.charAt(byte4))
    );
  }
  return result.join('');
}
