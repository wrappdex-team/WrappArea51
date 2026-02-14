import { type ReactNode } from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

interface TipProps {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  sideOffset?: number;
  delayDuration?: number;
}

/**
 * Styled tooltip wrapper — replaces native title="" attributes.
 * Uses Radix UI Tooltip with glass-morphism styling matching the app theme.
 */
export function Tip({
  content,
  children,
  side = "bottom",
  align = "center",
  sideOffset = 6,
  delayDuration = 200,
}: TipProps) {
  if (!content) return <>{children}</>;

  return (
    <TooltipPrimitive.Provider delayDuration={delayDuration}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            align={align}
            sideOffset={sideOffset}
            style={{
              backgroundColor: "rgba(15, 23, 42, 0.95)",
              color: "#e2e8f0",
              borderColor: "rgba(236, 72, 153, 0.2)",
            }}
            className="z-[200] max-w-xs rounded-lg px-3 py-1.5 text-xs font-medium shadow-xl
              border backdrop-blur-md
              animate-in fade-in-0 zoom-in-95
              data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95
              data-[side=bottom]:slide-in-from-top-1
              data-[side=top]:slide-in-from-bottom-1
              data-[side=left]:slide-in-from-right-1
              data-[side=right]:slide-in-from-left-1"
          >
            {content}
            <TooltipPrimitive.Arrow style={{ fill: "rgba(15, 23, 42, 0.95)" }} className="z-50" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}