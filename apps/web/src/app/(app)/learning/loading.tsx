// Route-level loading UI for /learning pages — instant feedback on
// navigation instead of the previous page hanging until the new one loads.
export default function Loading() {
  return (
    <div className="flex animate-pulse flex-col gap-6 py-6" aria-hidden>
      <div className="h-36 w-full rounded-lg bg-bg-2" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-52 rounded-lg bg-bg-2" />
        ))}
      </div>
    </div>
  );
}
