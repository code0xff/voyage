import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const alertVariants = cva(
  "relative w-full rounded-md border px-3 py-2 text-xs [&>svg+div]:translate-y-[-2px] [&>svg]:absolute [&>svg]:left-3 [&>svg]:top-3 [&>svg]:text-foreground [&>svg~*]:pl-6",
  {
    variants: {
      variant: {
        default: "bg-card text-card-foreground",
        destructive:
          "border-destructive/50 text-destructive [&>svg]:text-destructive bg-destructive/5",
        warning: "border-warning/40 bg-warning/10 [&>svg]:text-warning [color:hsl(38_92%_30%)]",
        info: "border-info/40 bg-info/10 [&>svg]:text-info [color:oklch(var(--info))]",
        success:
          "border-success/40 bg-success/10 [&>svg]:text-success [color:oklch(var(--success))]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div ref={ref} role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
));
Alert.displayName = "Alert";

const AlertTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h5
      ref={ref}
      className={cn("mb-1 font-medium leading-none tracking-tight", className)}
      {...props}
    />
  ),
);
AlertTitle.displayName = "AlertTitle";

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("text-xs [&_p]:leading-relaxed", className)} {...props} />
));
AlertDescription.displayName = "AlertDescription";

export { Alert, AlertTitle, AlertDescription };
