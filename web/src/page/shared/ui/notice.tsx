import type { FeedbackLevel } from "@/core";
import { Icon, type IconName } from "./icons";

const levels: Record<FeedbackLevel, { icon: IconName; text: string }> = {
  error: { icon: "xc", text: "text-fault" },
  warning: { icon: "warn", text: "text-warn-ink" },
  info: { icon: "info", text: "text-ink2" },
  success: { icon: "done", text: "text-ink" },
};

export function feedbackClass(level: FeedbackLevel): string {
  return levels[level].text;
}

export function FeedbackIcon({ level, size = 16 }: { level: FeedbackLevel; size?: number }) {
  return <span className={`mt-0.5 flex-none ${levels[level].text}`}><Icon name={levels[level].icon} size={size} /></span>;
}
