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
    <TabsPrimitive.List
      data-slot="page-tabs-list"
      className={cn(
        "flex w-full border-b border-[#DEDFE3]",
        className
      )}
      {...props}
    />
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
        "font-normal text-[18px] leading-none whitespace-nowrap transition-colors",
        "text-[#5D636F]/60 hover:text-[#5D636F]",
        "focus-visible:outline-none",
        "data-[state=active]:text-[#5D636F]",
        "after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[1px]",
        "after:bg-[#5AC4FF] after:opacity-0 after:transition-opacity",
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