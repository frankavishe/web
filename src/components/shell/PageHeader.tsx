import Link from "next/link";

/** Header for right-pane pages; the back link is only shown on narrow screens. */
export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="flex items-center gap-3 border-b border-border bg-surface px-4 py-3 md:px-8">
      <Link
        href="/"
        className="rounded-lg px-2 py-1 text-sm text-muted hover:bg-surface-2 md:hidden"
        aria-label="Back to chats"
      >
        ←
      </Link>
      <div>
        <h1 className="text-lg font-semibold">{title}</h1>
        {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
      </div>
    </header>
  );
}
