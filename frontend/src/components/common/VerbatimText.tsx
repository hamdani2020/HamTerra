import { cn } from "@/lib/utils";

export interface VerbatimTextProps {
  text: string;
  as?: "p" | "span" | "li";
  className?: string;
}

/**
 * Renders Backend text (summary_text, limitations, caveats, warning messages) exactly as
 * received: a plain text node, no HTML interpretation, no truncation or ellipsis, wrapping
 * long words at any width (Requirement 20.9).
 */
export function VerbatimText({ text, as: Tag = "p", className }: VerbatimTextProps): JSX.Element {
  return (
    <Tag className={cn("whitespace-normal [overflow-wrap:anywhere]", className)}>{text}</Tag>
  );
}
