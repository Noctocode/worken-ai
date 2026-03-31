import * as React from "react"
import { Search } from "lucide-react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const searchInputVariants = cva(
  "flex items-center gap-2 rounded-md border bg-white transition-[color,box-shadow] outline-none focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[1px]",
  {
    variants: {
      size: {
        default: "h-[42px] px-4",
        sm: "h-10 px-3",
        lg: "h-16 px-5",
      },
    },
    defaultVariants: {
      size: "default",
    },
  }
)

function SearchInput({
  className,
  size = "default",
  iconClassName,
  ...props
}: Omit<React.ComponentProps<"input">, "size"> &
  VariantProps<typeof searchInputVariants> & {
    iconClassName?: string
  }) {
  return (
    <div
      data-slot="search-input"
      className={cn(
        searchInputVariants({ size }),
        "border-border-3",
        className
      )}
    >
      <Search
        className={cn(
          "h-4.5 w-4.5 shrink-0 text-text-3",
          iconClassName
        )}
      />
      <input
        type="text"
        placeholder="Search"
        className="h-full w-full min-w-0 bg-white text-[16px] font-normal text-text-3 placeholder:text-text-3 outline-none"
        {...props}
      />
    </div>
  )
}

export { SearchInput, searchInputVariants }