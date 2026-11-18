/* eslint-disable @next/next/no-img-element -- avatars come from the API with long cache headers */

const SIZES = { sm: "size-9 text-sm", md: "size-11 text-base", lg: "size-28 text-3xl" } as const;

export function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function Avatar({
  name,
  src,
  size = "md",
}: {
  name: string | null | undefined;
  src: string | null | undefined;
  size?: keyof typeof SIZES;
}) {
  const cls = `${SIZES[size]} shrink-0 rounded-full`;
  if (src) return <img src={src} alt="" className={`${cls} object-cover`} />;
  return (
    <span
      aria-hidden
      className={`${cls} grid place-items-center bg-accent-soft font-semibold text-accent`}
    >
      {initials(name)}
    </span>
  );
}
