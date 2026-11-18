export default function HomePage() {
  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
      <div className="relative">
        <span className="grid size-24 place-items-center rounded-[2rem] bg-accent text-4xl font-bold text-accent-fg">
          C
        </span>
        <span className="absolute -right-2 -bottom-2 size-8 rounded-full border-4 border-bg bg-highlight" />
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">Chat App for the web</h1>
      <p className="max-w-md text-muted">
        Pick a chat on the left, or start a new one. Your phone doesn&apos;t need to stay online for
        this browser to work.
      </p>
    </section>
  );
}
