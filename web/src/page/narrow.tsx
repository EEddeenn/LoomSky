import { Icon } from "./shared/ui";

export function Narrow() {
  return (
    <div role="main" className="hidden h-full place-items-center bg-panel px-4 py-6 max-[1023px]:grid">
      <div className="flex max-w-[380px] flex-col gap-3">
        <span className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-key bg-ink text-panel">
            <Icon name="logo" size={18} />
          </span>
          <span className="font-cond text-title font-semibold tracking-[0.14em] uppercase">
            Loom<span className="font-medium text-ink2">Sky</span>
          </span>
        </span>
        <h1 className="m-0 mt-2 text-[20px] leading-7 font-semibold">Widen the window</h1>
        <p className="m-0 text-ink2">Use a window at least 1024 px wide. Transmitters keep running.</p>
      </div>
    </div>
  );
}
