"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "./utils";

export interface Tab {
  id: string;
  label: string;
  icon?: React.ReactNode;
  badge?: React.ReactNode | number;
}

interface TabsProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  darkMode?: boolean;
  className?: string;
}

function Tabs({ tabs, activeTab, onTabChange, darkMode, className }: TabsProps) {
  return (
    <TabsPrimitive.Root
      value={activeTab}
      onValueChange={onTabChange}
      data-slot="tabs"
      className={cn("flex flex-col gap-2", className)}
    >
      <TabsPrimitive.List
        data-slot="tabs-list"
        className={cn(
          "inline-flex h-10 w-full items-center gap-2 rounded-xl bg-muted/60 p-1", 
          darkMode ? "text-gray-300" : "text-gray-700",
        )}
      >
        {tabs.map((tab) => (
          <TabsPrimitive.Trigger
            key={tab.id}
            value={tab.id}
            data-slot="tabs-trigger"
            className={cn(
              "data-[state=active]:bg-card inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-transparent px-3 py-2 text-sm font-medium transition-colors",
              "focus-visible:outline-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
              "data-[state=active]:border-input data-[state=active]:shadow-sm",
              darkMode
                ? "text-gray-300 data-[state=active]:text-white"
                : "text-gray-700 data-[state=active]:text-gray-900",
            )}
          >
            {tab.icon && <span className="inline-flex items-center gap-1">{tab.icon}</span>}
            <span>{tab.label}</span>
            {tab.badge !== undefined && (
              <span className="ml-1 inline-flex min-w-5 items-center justify-center rounded-full bg-primary/15 px-2 text-xs text-primary">
                {tab.badge}
              </span>
            )}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
    </TabsPrimitive.Root>
  );
}

function TabsList(props: React.ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List data-slot="tabs-list" {...props} />;
}

function TabsTrigger(props: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return <TabsPrimitive.Trigger data-slot="tabs-trigger" {...props} />;
}

function TabsContent(props: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot="tabs-content" {...props} />;
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
