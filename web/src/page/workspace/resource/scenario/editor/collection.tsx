import type { ReactNode } from "react";

type CollectionItem = {
  label: ReactNode;
  detail?: ReactNode;
  summary?: ReactNode;
  problem?: "error" | "warning" | null;
};

export function CollectionEditor({ label, items, selected, onSelect, actions, detailTitle, detailActions, detailPath, empty, children }: {
  label: string;
  items: readonly CollectionItem[];
  selected: number;
  onSelect(index: number): void;
  actions?: ReactNode;
  detailTitle?: ReactNode;
  detailActions?: ReactNode;
  detailPath?: string;
  empty: string;
  children?: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-3" aria-label={label}>
      <header className="flex flex-wrap items-center gap-2">
        <h4 className="lab m-0 text-ink2">{label} <span className="fn text-ink3">{items.length}</span></h4>
        <span className="flex-1" />
        {actions}
      </header>
      {items.length === 0 ? <p className="m-0 text-small text-ink3">{empty}</p> : (
        <>
          <div className="max-h-64 overflow-y-auto rounded-key ring-key" role="group" aria-label={`Select ${label.toLowerCase()}`}>
            {items.map((item, index) => (
              <button
                key={index}
                type="button"
                aria-pressed={selected === index}
                onClick={() => onSelect(index)}
                className={`flex w-full min-w-0 flex-col gap-1 border-b border-line px-3 py-2 text-left last:border-b-0 ${selected === index ? "bg-inset shadow-[inset_3px_0_0_var(--ink)]" : "bg-face hover:bg-hover"}`}
              >
                <span className="flex w-full min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{item.label}</span>
                  {item.problem ? <span className={`ml-auto text-small ${item.problem === "error" ? "text-fault" : "text-warn-ink"}`}>{item.problem === "error" ? "Error" : "Warning"}</span> : null}
                </span>
                {item.detail ? <span className="fn min-w-0 text-small text-ink2 [overflow-wrap:anywhere]">{item.detail}</span> : null}
                {item.summary ? <span className="min-w-0 text-small text-ink3 [overflow-wrap:anywhere]">{item.summary}</span> : null}
              </button>
            ))}
          </div>
          <div key={detailPath} data-path={detailPath} className="flex min-w-0 flex-col gap-3 border-l-2 border-line pl-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="lab text-ink2">{detailTitle}</span>
              <span className="flex-1" />
              {detailActions}
            </div>
            {children}
          </div>
        </>
      )}
    </section>
  );
}
