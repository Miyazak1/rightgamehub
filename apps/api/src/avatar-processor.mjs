import sharp from 'sharp';

const MAX_PIXELS = 1024 * 1024;
const MAX_FRAMES = 60;
const MAX_DURATION_MS = 15_000;
const OUTPUT_EDGE = 512;

export class AvatarProcessingError extends Error {
  constructor(message) { super(message); this.name = 'AvatarProcessingError'; }
}

const options = animated => ({
  animated,
  failOn: 'warning',
  limitInputPixels: animated ? MAX_PIXELS * MAX_FRAMES : MAX_PIXELS,
  limitInputChannels: 4,
  sequentialRead: true,
});

const dimensions = metadata => ({ width: metadata.width, height: metadata.pageHeight || metadata.height });

export async function processAvatarImage(body, expected) {
  try {
    const metadata = await sharp(body, options(expected.animated)).metadata();
    const { width, height } = dimensions(metadata);
    const frameCount = Number(metadata.pages || 1);
    const delays = Array.isArray(metadata.delay) ? metadata.delay : [];
    const durationMs = delays.reduce((sum, delay) => sum + Math.max(10, Number(delay) || 100), 0);
    const expectedFormat = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' }[expected.mediaType];
    if (metadata.format !== expectedFormat || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 1024 || height > 1024 || width * height > MAX_PIXELS) throw new AvatarProcessingError('解码后的头像尺寸或格式无效。');
    if (frameCount < 1 || frameCount > MAX_FRAMES || (frameCount > 1 && (delays.length !== frameCount || durationMs > MAX_DURATION_MS))) throw new AvatarProcessingError('解码后的动画帧数或时长超出限制。');
    if (expected.animated !== (frameCount > 1)) throw new AvatarProcessingError('文件容器与解码结果的动画信息不一致。');

    const base = sharp(body, options(expected.animated))
      .rotate()
      .resize({ width: OUTPUT_EDGE, height: OUTPUT_EDGE, fit: 'inside', withoutEnlargement: true })
      .timeout({ seconds: 3 });
    const animated = frameCount > 1;
    const output = await base.webp(animated
      ? { quality: 82, alphaQuality: 90, effort: 4, loop: 0, delay: delays }
      : { quality: 88, alphaQuality: 100, effort: 4 }).toBuffer({ resolveWithObject: true });
    const poster = await sharp(body, { ...options(false), page: 0, pages: 1 })
      .rotate()
      .resize({ width: OUTPUT_EDGE, height: OUTPUT_EDGE, fit: 'inside', withoutEnlargement: true })
      .timeout({ seconds: 3 })
      .webp({ quality: 88, alphaQuality: 100, effort: 4 })
      .toBuffer({ resolveWithObject: true });
    if (output.data.length > 2 * 1024 * 1024 || poster.data.length > 512 * 1024) throw new AvatarProcessingError('处理后的头像文件仍然过大。');
    return {
      body: output.data,
      mediaType: 'image/webp',
      posterBody: poster.data,
      posterMediaType: 'image/webp',
      animated,
      width: output.info.width,
      height: animated ? output.info.pageHeight : output.info.height,
      frameCount,
      durationMs: animated ? durationMs : 0,
    };
  } catch (error) {
    if (error instanceof AvatarProcessingError) throw error;
    throw new AvatarProcessingError('头像无法被安全解码或处理超时。');
  }
}
