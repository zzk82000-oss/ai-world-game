import { IMAGE_MAX_CHARS } from './game/cast';

const MAX_SIDE = 600;

// 写真を、長辺600px以内に縮小して、data URL にする(端末の中だけで処理する)
export async function fileToIcon(file: File): Promise<{ ok: true; dataUrl: string } | { ok: false; error: string }> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return { ok: false, error: 'JPEG・PNG・WebP の画像を選んでください' };
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { ok: false, error: '画像を処理できませんでした' };
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    for (const q of [0.85, 0.7, 0.55]) {
      const url = canvas.toDataURL('image/webp', q);
      if (url.startsWith('data:image/webp') && url.length <= IMAGE_MAX_CHARS) return { ok: true, dataUrl: url };
      const jpg = canvas.toDataURL('image/jpeg', q);
      if (jpg.length <= IMAGE_MAX_CHARS) return { ok: true, dataUrl: jpg };
    }
    return { ok: false, error: '画像が大きすぎます(縮小しても入りませんでした)' };
  } catch {
    return { ok: false, error: '画像を読み込めませんでした' };
  }
}
