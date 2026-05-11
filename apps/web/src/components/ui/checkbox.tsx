"use client"

import * as React from "react"
import { Checkbox as CheckboxPrimitive } from "radix-ui"
import { Check, Minus } from "lucide-react"

import { cn } from "@/lib/utils"

// Three-state checkbox: unchecked / checked / indeterminate. The
// indeterminate "—" glyph drives the "some-but-not-all selected"
// state of the bulk select-all header in /knowledge-core. Radix
// emits data-state="indeterminate" when `checked === 'indeterminate'`,
// so we render the minus icon there and the check icon for `checked`.
function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer h-4 w-4 shrink-0 rounded border border-border-3 bg-bg-white shadow-sm cursor-pointer",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "data-[state=checked]:bg-primary-6 data-[state=checked]:border-primary-6 data-[state=checked]:text-white",
        "data-[state=indeterminate]:bg-primary-6 data-[state=indeterminate]:border-primary-6 data-[state=indeterminate]:text-white",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current"
      >
        {props.checked === "indeterminate" ? (
          <Minus className="h-3 w-3" strokeWidth={3} />
        ) : (
          <Check className="h-3 w-3" strokeWidth={3} />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
