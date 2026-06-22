import { cn } from "@/lib/utils"

function Skeleton({
  className,
  ...props
}) {
  return (
    (<div
      className={cn("ui-shimmer rounded-md bg-muted/60", className)}
      {...props} />)
  );
}

export { Skeleton }
