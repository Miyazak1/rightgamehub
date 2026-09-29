import sharp from 'sharp';

const MAX_INPUT_PIXELS = 16 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 1024 * 1024;

export class CoverProcessingError extends Error {
  constructor(message) { super(message); this.name = 'CoverProcessingError'; }
}

export async function processCoverImage(body) {
  try {
    const input = sharp(body, { failOn: 'warning', limitInputPixels: MAX_INPUT_PIXELS, limitInputChannels: 4, sequentialRead: true });
    const metadata = await input.metadata();
    if (!['jpeg', 'png', 'webp'].includes(metadata.format) || !Number.isInteger(metadata.width) || !Number.isInteger(metadata.height)
      || metadata.width < 1 || metadata.height < 1 || metadata.width > 4096 || metadata.height > 4096
      || metadata.width * metadata.height > MAX_INPUT_PIXELS || Number(metadata.pages || 1) !== 1) {
      throw new CoverProcessingError('封面必须是有效的静态 PNG、JPEG 或 WebP 图片。');
    }
    const output = await sharp(body, { failOn: 'warning', limitInputPixels: MAX_INPUT_PIXELS, limitInputChannels: 4, sequentialRead: true })
      .rotate()
      .resize({ width: 960, height: 540, fit: 'cover', position: 'attention' })
      .timeout({ seconds: 4 })
      .webp({ quality: 86, alphaQuality: 95, effort: 5 })
      .toBuffer({ resolveWithObject: true });
    if (output.data.length < 1 || output.data.length > MAX_OUTPUT_BYTES) throw new CoverProcessingError('处理后的封面文件仍然过大。');
    return { body: output.data, mediaType: 'image/webp', width: output.info.width, height: output.info.height };
  } catch (error) {
    if (error instanceof CoverProcessingError) throw error;
    throw new CoverProcessingError('封面无法被安全解码或处理超时。');
  }
}
