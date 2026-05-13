export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Footer used to live here, but it now ships from the global app
  // layout so every authed page gets the same bottom row instead of
  // just the dashboard.
  return <>{children}</>;
}
