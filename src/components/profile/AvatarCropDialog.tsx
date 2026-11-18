"use client";

import { useEffect, useRef, useState } from "react";
import Cropper, { type Area, type Point } from "react-easy-crop";
import { cropToBlob } from "@/lib/crop-image";

/** Modal that lets the user pick a square area of `src`; resolves with the cropped image. */
export function AvatarCropDialog({
  src,
  onCancel,
  onConfirm,
}: {
  src: string;
  onCancel: () => void;
  onConfirm: (blob: Blob) => void | Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  async function confirm() {
    if (!area) return;
    setBusy(true);
    try {
      await onConfirm(await cropToBlob(src, area));
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
      className="m-auto w-[min(92vw,440px)] rounded-3xl border border-border bg-surface p-0 text-fg backdrop:bg-black/60"
    >
      <div className="p-5">
        <h2 className="text-lg font-semibold">Crop your photo</h2>
        <p className="text-sm text-muted">Drag to position, scroll or use the slider to zoom.</p>
      </div>
      <div className="relative h-80 bg-black">
        <Cropper
          image={src}
          crop={crop}
          zoom={zoom}
          aspect={1}
          cropShape="round"
          showGrid={false}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={(_, pixels) => setArea(pixels)}
        />
      </div>
      <div className="flex flex-col gap-4 p-5">
        <label className="flex items-center gap-3 text-sm text-muted">
          Zoom
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="flex-1 accent-[var(--accent)]"
          />
        </label>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="rounded-xl px-4 py-2 text-sm font-medium text-muted hover:bg-surface-2"
          >
            Cancel
          </button>
          <button
            onClick={() => void confirm()}
            disabled={busy || !area}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-accent-fg disabled:opacity-50"
          >
            {busy ? "Uploading…" : "Use photo"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
