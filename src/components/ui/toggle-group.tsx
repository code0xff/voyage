import * as React from "react";
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * A joined group of toggle buttons, in the house sizes.
 *
 * Not part of the generated design system: added by hand for the settings'
 * on/off controls, so it follows the system's conventions (h-8, text-xs,
 * semantic tokens, cva) rather than upstream shadcn's own toggle styling.
 * Radix carries the keyboard contract -- one tab stop, arrows rove the
 * focus, Enter or Space selects -- which two hand-joined Buttons could not.
 * Logical corner and margin utilities (s/e, not l/r) keep the joined edge
 * on the right side of an RTL layout, and the focused seam outranks the
 * selected one (z-20 over z-10) so the ring is never painted over.
 *
 * Items size to their labels but never below `min-w-12`, so a two-option
 * switch reads as one control rather than two buttons of different sizes:
 * "Off" is a wider word than "On", and at these paddings that showed as a
 * 1.4 px step between the halves. A group that should fill its row asks for
 * it (`flex-1` on the items, or `w-full` on the root). Filling by default
 * made a two-word on/off switch as wide as the panel, which read as a much
 * more important control than it is.
 */
const toggleGroupItemVariants = cva(
  "inline-flex min-w-12 items-center justify-center gap-1.5 whitespace-nowrap rounded text-xs font-medium text-muted-foreground transition-all hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow [&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      size: {
        default: "px-3 py-1",
        sm: "px-2.5 py-1",
      },
    },
    defaultVariants: { size: "default" },
  },
);

const ToggleGroup = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root>
>(({ className, ...props }, ref) => (
  <ToggleGroupPrimitive.Root
    ref={ref}
    className={cn("inline-flex items-center justify-center rounded-md bg-muted p-0.5", className)}
    {...props}
  />
));
ToggleGroup.displayName = ToggleGroupPrimitive.Root.displayName;

const ToggleGroupItem = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item> &
    VariantProps<typeof toggleGroupItemVariants>
>(({ className, size, ...props }, ref) => (
  <ToggleGroupPrimitive.Item
    ref={ref}
    className={cn(toggleGroupItemVariants({ size }), className)}
    {...props}
  />
));
ToggleGroupItem.displayName = ToggleGroupPrimitive.Item.displayName;

export { ToggleGroup, ToggleGroupItem };
