import { createElement, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

import { cn } from "@/lib/utils";

/**
 * Whether the element has entered the viewport once. Without IntersectionObserver (older
 * browsers, tests) `supported` is false and `inView` is true, so content is never hidden.
 */
export function useInView<T extends Element>(): { ref: RefObject<T>; inView: boolean; supported: boolean } {
  const ref = useRef<T>(null);
  const supported = typeof window !== "undefined" && "IntersectionObserver" in window;
  const [inView, setInView] = useState(!supported);
  useEffect(() => {
    const node = ref.current;
    if (!supported || !node || inView) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [supported, inView]);
  return { ref, inView, supported };
}

/**
 * Fades content in when it first scrolls into view: 200 ms, the longest transition the
 * design allows (21.10). Reduced motion turns the transition off globally (21.11).
 */
export function Reveal({ as = "div", className, children }: { as?: "div" | "li" | "article"; className?: string; children: ReactNode }): JSX.Element {
  const { ref, inView } = useInView<HTMLElement>();
  return createElement(
    as,
    { ref, className: cn("transition-[opacity,transform] duration-200 ease-out", inView ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0", className) },
    children,
  );
}
