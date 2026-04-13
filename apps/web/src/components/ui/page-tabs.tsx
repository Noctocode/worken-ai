"use client"

import * as React from "react"
import { Tabs as TabsPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function PageTabs({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="page-tabs"
      className={cn("flex flex-col", className)}
      {...props}
    />
  )
}

function PageTabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <div className="overflow-x-auto -mx-6 px-6 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
      <TabsPrimitive.List
        data-slot="page-tabs-list"
        className={cn(
          "flex w-max min-w-full border-b border-black-100",
          className
        )}
        {...props}
      />
    </div>
  )
}

function PageTabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="page-tabs-trigger"
      className={cn(
        "relative flex items-center justify-center px-4 h-[55px]",
        "text-[18px] leading-none whitespace-nowrap transition-colors",
        "focus-visible:outline-none",
        // inactive
        "font-normal text-black-700 hover:text-black-700/75 cursor-pointer",
        // active
        "data-[state=active]:font-bold data-[state=active]:text-black-900",
        // active indicator
        "after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[1px]",
        "after:bg-primary-5 after:opacity-0 after:transition-opacity",
        "data-[state=active]:after:opacity-100",
        className
      )}
      {...props}
    />
  )
}

function PageTabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="page-tabs-content"
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  )
}

export { PageTabs, PageTabsList, PageTabsTrigger, PageTabsContent }