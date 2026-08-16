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
 * Radix carries the keyboard contract -- one tab stop, arrows move the
 * selection -- which two hand-joined Buttons could not.
 */
const toggleGroupItemVariants = cva(
  "inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap border border-input bg-background text-xs font-medium transition-colors first:rounded-l-md last:rounded-r-md [&:not(:first-child)]:-ml-px hover:bg-accent hover:text-accent-foreground focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=on]:z-10 data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground [&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      size: {
        default: "h-8 px-3 py-1.5",
        sm: "h-7 px-2.5",
      },
    },
    defaultVariants: { size: "default" },
  },
);

const ToggleGroup = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root>
>(({ className, ...props }, ref) => (
  <ToggleGroupPrimitive.Root ref={ref} className={cn("flex", className)} {...props} />
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
