"use client";

import * as React from "react";
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { ChevronDownIcon } from "lucide-react";

import { cn } from "./utils";

export interface AccordionItemConfig {
  id: string;
  title: string;
  content: React.ReactNode;
  icon?: React.ReactNode;
  badge?: React.ReactNode | number;
}

interface AccordionProps {
  items: AccordionItemConfig[];
  defaultOpenItems?: string[];
  /**
   * Restrict to multiple to align with Radix prop typing; single selection not needed in app today.
   */
  allowMultiple?: boolean;
  darkMode?: boolean;
  className?: string;
}

function Accordion({ items, defaultOpenItems, allowMultiple = true, darkMode, className }: AccordionProps) {
  return (
    <AccordionPrimitive.Root
      type={allowMultiple ? "multiple" : "multiple"}
      defaultValue={defaultOpenItems}
      data-slot="accordion"
      className={className}
    >
      {items.map((item) => (
        <AccordionPrimitive.Item
          key={item.id}
          value={item.id}
          data-slot="accordion-item"
          className={cn("border-b last:border-b-0", darkMode ? "border-white/10" : "border-gray-200")}
        >
          <AccordionPrimitive.Header className="flex">
            <AccordionPrimitive.Trigger
              data-slot="accordion-trigger"
              className={cn(
                "flex flex-1 items-center justify-between gap-3 py-4 text-left text-sm font-medium transition-all outline-none",
                "focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-ring",
                "data-[state=open]:text-primary",
                darkMode ? "text-gray-200" : "text-gray-800",
              )}
            >
              <div className="flex items-center gap-2">
                {item.icon}
                <span>{item.title}</span>
                {item.badge !== undefined && (
                  <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-primary/15 px-2 text-xs text-primary">
                    {item.badge}
                  </span>
                )}
              </div>
              <ChevronDownIcon className="text-muted-foreground pointer-events-none size-4 shrink-0 transition-transform duration-200 data-[state=open]:rotate-180" />
            </AccordionPrimitive.Trigger>
          </AccordionPrimitive.Header>
          <AccordionPrimitive.Content
            data-slot="accordion-content"
            className="data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down overflow-hidden text-sm"
          >
            <div className={cn("pt-0 pb-4", darkMode ? "text-gray-300" : "text-gray-700")}>{item.content}</div>
          </AccordionPrimitive.Content>
        </AccordionPrimitive.Item>
      ))}
    </AccordionPrimitive.Root>
  );
}

type AccordionItem = AccordionItemConfig;

function AccordionTrigger(props: React.ComponentProps<typeof AccordionPrimitive.Trigger>) {
  return <AccordionPrimitive.Trigger data-slot="accordion-trigger" {...props} />;
}

function AccordionContent(props: React.ComponentProps<typeof AccordionPrimitive.Content>) {
  return <AccordionPrimitive.Content data-slot="accordion-content" {...props} />;
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent };
