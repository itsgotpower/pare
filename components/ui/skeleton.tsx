import { cn } from "@/lib/utils";

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse bg-muted", className)}
      {...props}
    />
  );
}

export function DashboardSkeleton() {
  return (
    <div className="p-6">
      <Skeleton className="h-8 w-48 mb-6" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-[1px] bg-border border border-border">
        <div className="col-span-1 md:col-span-2 bg-card p-6">
          <Skeleton className="h-4 w-32 mb-4" />
          <Skeleton className="h-[220px] w-full" />
        </div>
        <div className="row-span-2 bg-card p-6">
          <Skeleton className="h-4 w-32 mb-4" />
          <Skeleton className="h-[180px] w-full" />
        </div>
        <div className="bg-card p-6">
          <Skeleton className="h-4 w-24 mb-2" />
          <Skeleton className="h-10 w-40" />
        </div>
        <div className="bg-card p-6">
          <Skeleton className="h-4 w-24 mb-2" />
          <Skeleton className="h-10 w-40" />
        </div>
      </div>
    </div>
  );
}

export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      <div className="flex gap-4 py-3 border-b">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-20 ml-auto" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4 py-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-20 ml-auto" />
        </div>
      ))}
    </div>
  );
}

export { Skeleton };
