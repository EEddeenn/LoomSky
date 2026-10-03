import { useId, type ReactNode } from "react";
import { diagnosticsAt, pathKey, type WriteChange } from "@/model/document";
import { Field, Messages, NumberField, Select } from "@/page/shared/documents/editor";
import { Button } from "@/page/shared/ui";
import type { TrajectoryDoc } from "@/workbench/documents/trajectory";
import { changeDocument } from "@/workbench/documents/editing";

export type InspectorPath = (string | number)[];
type InspectorOption = { value: string; label: string };

export function PositionFields({ doc, path }: { doc: TrajectoryDoc; path: InspectorPath }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <NumberField doc={doc.editor} path={[...path, "latitude"]} label="Latitude" unit="°N" />
      <NumberField doc={doc.editor} path={[...path, "longitude"]} label="Longitude" unit="°E" />
      <NumberField doc={doc.editor} path={[...path, "altitude"]} label="Altitude" unit="m" />
    </div>
  );
}

export function VectorFields({ doc, path, unit }: { doc: TrajectoryDoc; path: InspectorPath; unit: string }) {
  return <div className="grid grid-cols-2 gap-3">
    {["X", "Y", "Z"].map((axis, index) => <NumberField key={axis} doc={doc.editor} path={[...path, index]} label={`ECEF ${axis}`} unit={unit} />)}
  </div>;
}

export function SideSelect({ doc, path, label, defaultLabel }: { doc: TrajectoryDoc; path: InspectorPath; label: string; defaultLabel: string }) {
  return <InspectorSelect doc={doc} path={path} label={label}
    options={[{ value: "", label: defaultLabel }, { value: "in", label: "Incoming" }, { value: "out", label: "Outgoing" }]}
    changes={(side) => [{ path, value: side === "" ? undefined : side }]} />;
}

export function InspectorSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-2 border-t border-line2 pt-3">
      <h4 className="m-0 text-small font-semibold text-ink2">{title}</h4>
      {children}
    </section>
  );
}

export function InspectorDisclosure({ title, summary, children }: { title: string; summary?: string; children: ReactNode }) {
  return (
    <details className="min-w-0 border-t border-line2 pt-3">
      <summary className="cursor-pointer text-small font-semibold text-ink2">
        {title}{summary === undefined ? null : <span className="font-normal text-ink3"> · {summary}</span>}
      </summary>
      <div className="flex min-w-0 flex-col gap-3 pt-3">{children}</div>
    </details>
  );
}

export function InspectorHeading({ title, id, onBack }: { title: string; id?: string; onBack?(): void }) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <div className="min-w-0 flex-1">
        <h3 className="m-0 font-semibold">{title}</h3>
        {id === undefined ? null : <p className="fn mt-1 mb-0 break-all text-small text-ink3">{id}</p>}
      </div>
      {onBack === undefined ? null : <Button size="xs" variant="ghost" onClick={onBack}>Plan</Button>}
    </div>
  );
}

export function InspectorSelect({ doc, path, label, options, value, onChange, changes, diagnostics = true }: {
  doc: TrajectoryDoc;
  path: InspectorPath;
  label: string;
  options: readonly InspectorOption[];
  value?: string;
  diagnostics?: boolean;
} & (
  | { onChange(value: string): void; changes?: never }
  | { onChange?: never; changes?(value: string): readonly WriteChange[] }
)) {
  const raw = doc.editor.value(path);
  const selected = value ?? (typeof raw === "string" ? raw : "");
  const id = useId();
  return (
    <Field label={label} htmlFor={id} path={pathKey(doc.kind, path)}>
      <Select
        id={id}
        aria-label={label}
        value={selected}
        disabled={!doc.editor.writable()}
        onChange={(event) => {
          const next = event.target.value;
          if (onChange !== undefined) onChange(next);
          else changeDocument(doc, () => doc.editor.writeMany(changes?.(next) ?? [{ path, value: next }]));
        }}
      >
        {options.some((option) => option.value === selected) ? null : <option value={selected}>{selected === "" ? "Choose a value" : `${selected} (unrecognized)`}</option>}
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </Select>
      {diagnostics ? <Messages doc={doc.editor} diagnostics={diagnosticsAt(doc.editor, path, "self")} /> : null}
    </Field>
  );
}
