import { Footer } from "@/components/layout";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="p-4 sm:p-8">
        <div className="mx-auto max-w-7xl">
          {children}
        </div>
        <Footer />
      </div>
    </div>
  );
}
