import { useStore } from "@/core";
import { events } from "@/workbench/feedback";

export function Announcer() {
  const polite = useStore(events, (s) => s.polite);
  const assertive = useStore(events, (s) => s.assertive);
  return (
    <>
      <div className="vh" aria-live="polite">
        {polite}
      </div>
      <div className="vh" aria-live="assertive">
        {assertive}
      </div>
    </>
  );
}
