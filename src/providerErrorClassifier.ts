export function isImageNotSupportedErrorText(text: string | undefined): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();

  const patterns = [
    /does not support image/i,
    /do not support image/i,
    /does not support image_url/i,
    /do not support image_url/i,
    /image input is not supported/i,
    /image inputs? are not supported/i,
    /vision is not supported/i,
    /multimodal is not supported/i,
    /unsupported image/i,
    /image_url is only supported/i,
    /image_url is not supported/i,
    /model does not.*image/i,
    /model do not.*image/i,
    /image.*not supported/i,
    /image.*not available/i,
    /image.*not allowed/i,
  ];

  for (const pattern of patterns) {
    if (pattern.test(lower)) return true;
  }

  return false;
}
