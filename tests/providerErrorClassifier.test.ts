import { describe, expect, it } from 'vitest';
import { isImageNotSupportedErrorText } from '../src/providerErrorClassifier';

describe('isImageNotSupportedErrorText', () => {
  it('detects "does not support image"', () => {
    expect(isImageNotSupportedErrorText('This model does not support image input')).toBe(true);
  });

  it('detects "does not support images"', () => {
    expect(isImageNotSupportedErrorText('The model does not support images')).toBe(true);
  });

  it('detects "does not support image_url"', () => {
    expect(isImageNotSupportedErrorText('model does not support image_url')).toBe(true);
  });

  it('detects "image input is not supported"', () => {
    expect(isImageNotSupportedErrorText('image input is not supported by this model')).toBe(true);
  });

  it('detects "image_url is only supported"', () => {
    expect(isImageNotSupportedErrorText('image_url is only supported by certain models')).toBe(true);
  });

  it('detects "vision is not supported"', () => {
    expect(isImageNotSupportedErrorText('vision is not supported for this model')).toBe(true);
  });

  it('detects "multimodal is not supported"', () => {
    expect(isImageNotSupportedErrorText('multimodal is not supported')).toBe(true);
  });

  it('detects "unsupported image"', () => {
    expect(isImageNotSupportedErrorText('unsupported image type')).toBe(true);
  });

  it('detects "image_url is not supported"', () => {
    expect(isImageNotSupportedErrorText('image_url is not supported for this model')).toBe(true);
  });

  it('detects "model does not ... image" cross-pattern', () => {
    expect(isImageNotSupportedErrorText('The model gpt-3.5-turbo does not support image inputs.')).toBe(true);
  });

  it('detects "model do not ... image"', () => {
    expect(isImageNotSupportedErrorText('These models do not support image inputs.')).toBe(true);
  });

  it('detects "image ... not available"', () => {
    expect(isImageNotSupportedErrorText('image input is not available for this model')).toBe(true);
  });

  it('detects "image ... not allowed"', () => {
    expect(isImageNotSupportedErrorText('image content is not allowed for text-only models')).toBe(true);
  });

  it('returns false for "The image is too large"', () => {
    expect(isImageNotSupportedErrorText('The image is too large')).toBe(false);
  });

  it('returns false for "Invalid API key"', () => {
    expect(isImageNotSupportedErrorText('Invalid API key provided')).toBe(false);
  });

  it('returns false for rate limit error', () => {
    expect(isImageNotSupportedErrorText('Rate limit exceeded. Please try again later.')).toBe(false);
  });

  it('returns false for context overflow', () => {
    expect(isImageNotSupportedErrorText('context length exceeded')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isImageNotSupportedErrorText('')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isImageNotSupportedErrorText(undefined)).toBe(false);
  });

  it('returns false for "max_tokens is not supported"', () => {
    expect(isImageNotSupportedErrorText('max_tokens is not supported')).toBe(false);
  });

  it('returns false for "Invalid image format"', () => {
    expect(isImageNotSupportedErrorText('Invalid image format')).toBe(false);
  });
});
