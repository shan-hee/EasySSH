import { cn } from "@/lib/utils"

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <svg
      role="status"
      aria-label="Loading"
      viewBox="0 0 24 24"
      fill="none"
      className={cn("segmented-spinner size-4", className)}
      {...props}
    >
      {Array.from({ length: 12 }, (_, index) => (
        <line
          key={index}
          x1="12"
          y1="2.5"
          x2="12"
          y2="6"
          transform={`rotate(${index * 30} 12 12)`}
          stroke="currentColor"
          strokeWidth="2.25"
          strokeLinecap="round"
        />
      ))}
    </svg>
  )
}

export { Spinner }
