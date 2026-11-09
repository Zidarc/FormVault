// Local OCR with Tesseract — runs in the browser, costs nothing, and the image never leaves the computer.
// Only the recognised text (with personal details stripped) goes on to the AI.

import type * as TesseractNs from 'tesseract.js';

type Tess = typeof TesseractNs;
type OcrWorker = Awaited<ReturnType<Tess['createWorker']>>;

export interface OcrResult {
  text: string;
  /** 0–100, Tesseract's mean word confidence */
  confidence: number;
}

const url = (p: string) => (browser.runtime.getURL as (p: string) => string)(p);

let workerP: Promise<OcrWorker> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let report: ((pct: number) => void) | undefined;

async function getWorker(): Promise<OcrWorker> {
  clearTimeout(idleTimer);
  if (!workerP) {
    workerP = (async () => {
      // The ESM build avoids bundling tesseract's Node code paths.
      const T = (await import('tesseract.js/dist/tesseract.esm.min.js')) as unknown as Tess & { default?: Tess };
      const create = T.createWorker ?? T.default!.createWorker;
      return create('eng', 1 /* LSTM only */, {
        workerPath: url('/ocr/worker.min.js'),
        corePath: url('/ocr/tesseract-core-simd-lstm.wasm.js'),
        langPath: url('/ocr'),
        workerBlobURL: false,
        cacheMethod: 'none',
        gzip: true,
        logger: (m: { status: string; progress: number }) => {
          if (m.status === 'recognizing text') report?.(Math.round(m.progress * 100));
        },
      });
    })();
    workerP.catch(() => (workerP = null));
  }
  return workerP;
}

/** Free the ~30 MB the engine uses once nobody has needed it for a minute. */
function scheduleIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    const w = workerP;
    workerP = null;
    (await w?.catch(() => null))?.terminate();
  }, 60_000);
}

export async function loadBitmap(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob);
  } catch {
    throw new Error("Couldn't open this image. Try a PNG or JPG.");
  }
}

/** Resize an image so its longest side is between `min` and `max` pixels. */
export async function resizeImage(
  src: Blob | ImageBitmap,
  { max = 2000, min = 0, type = 'image/png', quality = 0.9 }: { max?: number; min?: number; type?: string; quality?: number } = {},
): Promise<Blob> {
  const bmp = src instanceof Blob ? await loadBitmap(src) : src;
  const long = Math.max(bmp.width, bmp.height);
  const scale = long > max ? max / long : long < min ? Math.min(min / long, 3) : 1;
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  // White background so transparent PNGs (screenshots of dark-mode text, logos) stay readable.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  return canvas.convertToBlob({ type, quality });
}

/** Read the text in an image, locally. */
export async function ocr(image: Blob, onProgress?: (pct: number) => void): Promise<OcrResult> {
  // Small screenshots read much better when scaled up; huge photos only slow things down.
  const prepared = await resizeImage(image, { max: 2400, min: 1200 });
  const worker = await getWorker();
  report = onProgress;
  try {
    const { data } = await worker.recognize(prepared);
    return { text: cleanOcrText(data.text ?? ''), confidence: data.confidence ?? 0 };
  } finally {
    report = undefined;
    scheduleIdle();
  }
}

/** Drop the junk lines OCR produces from borders, logos and icons. */
export function cleanOcrText(s: string): string {
  return s
    .split('\n')
    .map((l) => l.replace(/[|_~=<>{}\[\]\\]{2,}/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((l) => (l.match(/[A-Za-z0-9]/g)?.length ?? 0) >= 2 && /[A-Za-z]{2}|\d{2}/.test(l))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Did OCR find enough real text to be worth using? */
export function ocrUsable(r: OcrResult): boolean {
  const words = r.text.match(/[A-Za-z]{3,}/g)?.length ?? 0;
  return words >= 6 && r.confidence >= 45;
}
