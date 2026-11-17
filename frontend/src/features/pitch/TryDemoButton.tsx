import { FlaskConical } from "lucide-react";

import { useDemo } from "@/core/demo/DemoContext";
import { DEMO_TEXT } from "@/lib/messages";

import { darkFocus } from "./styles";

/** Opens the sign-in-free demo; offered only to visitors who are not signed in. */
export function TryDemoButton({ onDark = false }: { onDark?: boolean }): JSX.Element {
  const demo = useDemo();
  const tone = onDark
    ? `border border-brand-100 text-surface hover:bg-brand-700 ${darkFocus}`
    : "border border-brand-700 text-brand-700 hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
  return (
    <button type="button" onClick={demo.start} className={`inline-flex h-11 w-full items-center whitespace-nowrap justify-center gap-2 rounded-md px-5 text-sm font-semibold sm:w-auto ${tone}`}>
      <FlaskConical aria-hidden="true" className="h-4 w-4" />
      {DEMO_TEXT.start}
    </button>
  );
}

