"use client";

import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { AvatarCropDialog } from "@/components/profile/AvatarCropDialog";
import { PageHeader } from "@/components/shell/PageHeader";
import { api, call } from "@/lib/api/client";
import { checkAvatarFile } from "@/lib/crop-image";
import { errorMessage } from "@/lib/errors";
import { formatPhone } from "@/lib/phone";
import { useAuthStore } from "@/stores/auth";

const NAME_MAX = 25;
const ABOUT_MAX = 140;

export default function ProfilePage() {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);

  // null = not edited, so updates from other devices (profile:updated) show through.
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [aboutDraft, setAboutDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => {
    if (cropSrc) URL.revokeObjectURL(cropSrc);
  }, [cropSrc]);

  if (!user) return null;

  const name = nameDraft ?? user.displayName ?? "";
  const about = aboutDraft ?? user.about;
  const trimmedName = name.trim();
  const nameError =
    trimmedName.length === 0
      ? "Enter your name."
      : trimmedName.length > NAME_MAX
        ? `Use at most ${NAME_MAX} characters.`
        : null;
  const dirty = trimmedName !== (user.displayName ?? "") || about.trim() !== user.about;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (nameError || !user) return;
    setSaving(true);
    setMessage(null);
    try {
      const body: { displayName?: string; about?: string } = {};
      if (trimmedName !== user.displayName) body.displayName = trimmedName;
      if (about.trim() !== user.about) body.about = about.trim();
      const me = await call(() => api.PATCH("/me", { body }));
      setUser(me);
      setNameDraft(null);
      setAboutDraft(null);
      setMessage({ kind: "ok", text: "Profile saved." });
    } catch (err) {
      setMessage({ kind: "error", text: errorMessage(err) });
    } finally {
      setSaving(false);
    }
  }

  function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const problem = checkAvatarFile(file);
    if (problem) {
      setMessage({ kind: "error", text: problem });
      return;
    }
    setMessage(null);
    setCropSrc(URL.createObjectURL(file));
  }

  async function upload(blob: Blob) {
    try {
      const me = await call(() =>
        api.PUT("/me/avatar", {
          body: { file: "" },
          bodySerializer: () => {
            const form = new FormData();
            form.append("file", blob, blob.type === "image/webp" ? "avatar.webp" : "avatar.jpg");
            return form;
          },
        }),
      );
      setUser(me);
      setMessage({ kind: "ok", text: "Photo updated." });
    } catch (err) {
      setMessage({ kind: "error", text: errorMessage(err) });
    } finally {
      setCropSrc(null);
    }
  }

  async function removePhoto() {
    setPhotoBusy(true);
    setMessage(null);
    try {
      setUser(await call(() => api.DELETE("/me/avatar")));
    } catch (err) {
      setMessage({ kind: "error", text: errorMessage(err) });
    } finally {
      setPhotoBusy(false);
    }
  }

  const field =
    "w-full rounded-xl border border-border bg-surface px-4 py-3 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/25";

  return (
    <>
      <PageHeader
        title="Profile"
        subtitle={user.profileComplete ? undefined : "Add your name to start using Chat App."}
      />
      <div className="flex-1 overflow-y-auto">
        <form onSubmit={save} noValidate className="mx-auto flex max-w-lg flex-col gap-6 px-4 py-8">
          <div className="flex flex-col items-center gap-3">
            <Avatar name={user.displayName} src={user.avatarUrl} size="lg" />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="rounded-xl bg-accent-soft px-4 py-2 text-sm font-medium text-accent hover:brightness-95"
              >
                {user.avatarUrl ? "Change photo" : "Add photo"}
              </button>
              {user.avatarUrl && (
                <button
                  type="button"
                  onClick={() => void removePhoto()}
                  disabled={photoBusy}
                  className="rounded-xl px-4 py-2 text-sm font-medium text-danger hover:bg-danger-soft disabled:opacity-50"
                >
                  Remove
                </button>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={pickFile}
              aria-label="Profile photo"
            />
          </div>

          <label className="flex flex-col gap-1.5 text-sm font-medium">
            <span className="flex justify-between">
              Name
              <span className="font-normal text-muted">
                {trimmedName.length}/{NAME_MAX}
              </span>
            </span>
            <input
              value={name}
              onChange={(e) => setNameDraft(e.target.value)}
              maxLength={NAME_MAX}
              className={field}
              aria-invalid={nameDraft !== null && nameError ? true : undefined}
            />
            {nameDraft !== null && nameError && (
              <span className="font-normal text-danger">{nameError}</span>
            )}
          </label>

          <label className="flex flex-col gap-1.5 text-sm font-medium">
            <span className="flex justify-between">
              About
              <span className="font-normal text-muted">
                {about.length}/{ABOUT_MAX}
              </span>
            </span>
            <textarea
              value={about}
              onChange={(e) => setAboutDraft(e.target.value)}
              maxLength={ABOUT_MAX}
              rows={3}
              className={`${field} resize-none`}
            />
          </label>

          <div className="text-sm">
            <span className="text-muted">Phone</span>
            <p className="font-medium">{formatPhone(user.phone)}</p>
          </div>

          {message && (
            <p
              role={message.kind === "error" ? "alert" : "status"}
              className={`rounded-xl px-4 py-3 text-sm ${
                message.kind === "error" ? "bg-danger-soft text-danger" : "bg-accent-soft"
              }`}
            >
              {message.text}
            </p>
          )}

          <button
            type="submit"
            disabled={saving || !dirty || nameError !== null}
            className="rounded-xl bg-accent px-4 py-3 font-semibold text-accent-fg transition hover:brightness-110 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </form>
      </div>

      {cropSrc && (
        <AvatarCropDialog src={cropSrc} onCancel={() => setCropSrc(null)} onConfirm={upload} />
      )}
    </>
  );
}
