// Route-level loading UI. Shown instantly while a /toolkit page (e.g. the
// Prompt Builder) loads — gives immediate feedback on click instead of the
// previous page hanging until the new one is ready.
export default function Loading() {
  return (
    <div className="flex animate-pulse flex-col gap-6 py-6" aria-hidden>
      {/* Hero placeholder */}
      <div className="h-36 w-full rounded-lg bg-bg-2" />
      {/* Section heading placeholder */}
      <div className="h-6 w-40 rounded bg-bg-2" />
      {/* Content / card grid placeholder */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-52 rounded-lg bg-bg-2" />
        ))}
      </div>
    </div>
  );
}
