import type { Area } from "react-easy-crop";

export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
export const AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** Client-side pre-check; the server enforces the same limits (magic bytes, 5 MB). */
export function checkAvatarFile(file: File): string | null {
  if (!(AVATAR_TYPES as readonly string[]).includes(file.type)) return "Use a JPEG, PNG or WebP photo.";
  if (file.size > MAX_AVATAR_BYTES) return "That photo is too large. The limit is 5 MB.";
  return null;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not read the image"));
    img.src = src;
  });
}

/**
 * Crops `src` to the square `area` (in source pixels), scaled down to at most `maxSize`.
 * Encodes as WebP when the browser supports it, otherwise JPEG; the server re-encodes anyway.
 */
export async function cropToBlob(src: string, area: Area, maxSize = 640): Promise<Blob> {
  const img = await loadImage(src);
  const size = Math.min(maxSize, Math.round(area.width));
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, size, size);

  const toBlob = (type: string) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9));
  const webp = await toBlob("image/webp");
  if (webp && webp.type === "image/webp") return webp;
  const jpeg = await toBlob("image/jpeg");
  if (!jpeg) throw new Error("Could not encode the image");
  return jpeg;
}
