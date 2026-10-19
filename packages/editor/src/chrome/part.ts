import { useRender } from "@base-ui/react/use-render";
import type { ComponentPropsWithRef, ElementType, ReactElement } from "react";

import { cn } from "../lib/utils";

/**
 * What every chrome part accepts, the way Base UI parts do: the element's own props, a
 * `className` that may read the part's state, and a `render` prop that swaps the element while
 * keeping its behaviour (`render={<Button variant="ghost" />}` from a host's design system).
 */
export type PartProps<Tag extends ElementType, State extends Record<string, unknown>> = Omit<
  ComponentPropsWithRef<Tag>,
  "className" | "children"
> & {
  readonly className?: string | ((state: State) => string | undefined) | undefined;
  readonly render?: useRender.RenderProp<State> | undefined;
  readonly children?: ComponentPropsWithRef<Tag>["children"] | undefined;
};

/**
 * Render one chrome part: its `data-slot`, its state as data attributes (`data-layout="narrow"`,
 * a bare `data-busy` for true), the default classes merged with the caller's through
 * tailwind-merge so a host utility wins, and the caller's `render` element when given.
 */
export function usePart<State extends Record<string, unknown>>(
  slot: string,
  {
    className,
    render,
    ...props
  }: {
    readonly className?: string | ((state: State) => string | undefined) | undefined;
    readonly render?: useRender.RenderProp<State> | undefined;
    readonly [prop: string]: unknown;
  },
  options: {
    readonly state: State;
    readonly className?: string | undefined;
    readonly tag?: keyof React.JSX.IntrinsicElements | undefined;
    readonly props?: Record<string, unknown> | undefined;
  },
): ReactElement {
  const resolved = typeof className === "function" ? className(options.state) : className;
  // The host's attributes win over the part's defaults, its classes merge with them, and an event
  // handler both define runs the host's first and then the part's own.
  const merged: Record<string, unknown> = { "data-slot": slot, ...options.props };
  for (const [key, value] of Object.entries(props)) {
    const own = merged[key];
    merged[key] =
      /^on[A-Z]/.test(key) && typeof own === "function" && typeof value === "function"
        ? (...args: ReadonlyArray<unknown>) => {
            value(...args);
            own(...args);
          }
        : value;
  }
  merged.className = cn(options.className, resolved);
  return useRender({
    render,
    state: options.state,
    defaultTagName: options.tag ?? "div",
    props: merged,
  });
}
