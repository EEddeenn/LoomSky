"use client";

import { useId, useState, useSyncExternalStore, type ReactNode } from "react";
import { recordOf, useStore } from "@/core";
import { schemas } from "@/workbench/schemas";
import { defaultText, lookup, unitOf, type Path } from "@/model/schema";
import { diagnosticsAt, fieldKey, fieldReference, pathKey, draftProblemId, type DocumentDiagnostic, type TextDocument } from "@/model/document";
import { commitFieldDraft, discardFieldDraft, draftIssues, fieldDraft, prepareFieldDraft, setFieldDraft, subscribeDrafts, type DraftCodec } from "@/workbench/documents/editing";
import { openProblems } from "@/workbench/feedback";
import { FeedbackIcon, Toggle } from "@/page/shared/ui";
import { inputClass, Select, type Mark } from "./controls";
import { DiagnosticCue } from "@/page/shared/feedback";

export function markOf(diagnostics: DocumentDiagnostic[]): Mark {
  return diagnostics.some((d) => d.error) ? "err" : diagnostics.length > 0 ? "warn" : null;
}

export function Messages({ doc, diagnostics }: { doc: TextDocument; diagnostics: DocumentDiagnostic[] }) {
  return <DiagnosticCue docId={doc.id} diagnostics={diagnostics} stale={doc.status === "checking"} />;
}

export function useSchema(doc: TextDocument, path: Path) {
  const root = useStore(schemas, (s) => s[doc.kind]);
  const node = lookup(root, path, (p) => doc.value(p));
  const parent = path.length > 0 ? lookup(root, path.slice(0, -1), (p) => doc.value(p)) : null;
  const unit = unitOf(node, (key) => doc.value([...path.slice(0, -1), key]), parent);
  const current = doc.value(path);
  const objectDefault = doc.kind === "scenario" && path.length > 0 && doc.value(path.slice(0, -1)) === undefined
    ? recordOf(parent?.default)?.[String(path.at(-1))] : undefined;
  const fallback = objectDefault !== undefined ? objectDefault : node?.default;
  const automatic = node?.enum?.includes("auto") && (current === "auto" || (current === undefined && fallback === "auto"));
  return {
    node, unit,
    defaultText: defaultText(objectDefault === undefined ? node : { ...node, default: objectDefault }),
    source: doc.kind !== "scenario" ? undefined
      : automatic ? "Auto after checks"
      : current !== undefined ? "Explicit"
      : fallback === undefined ? "Not set"
      : "Default",
    description: node?.description ?? "",
    required: typeof path.at(-1) === "number" || (parent?.required?.includes(String(path.at(-1))) ?? false),
  };
}

export function DraftInput({ value, codec, doc, path, error, id: givenId, label, placeholder, mark = null, className = "", multiline = false, title }: {
  value: string;
  codec: DraftCodec;
  doc: TextDocument;
  path: Path;
  error: string;
  id?: string;
  label?: string;
  placeholder?: string;
  mark?: Mark;
  className?: string;
  multiline?: boolean;
  title?: string;
}) {
  const generatedId = useId();
  const id = givenId ?? generatedId;
  const ref = fieldReference(doc, path);
  const key = fieldKey(ref);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const pending = useSyncExternalStore((listener) => subscribeDrafts(doc, listener), () => fieldDraft(doc, ref), () => undefined);
  const binding = { ...(pending ?? { codec, error }), path };
  const draft = pending?.text ?? value;
  const dirty = pending !== undefined;
  const parsed = prepareFieldDraft(binding, draft);
  const issue = dirty ? draftIssues(doc).find((issue) => fieldKey(issue.ref) === key) : undefined;
  const invalid = dirty && (parsed === null || issue !== undefined || failure?.key === key);
  const setDraft = (text: string) => {
    setFailure(null);
    setFieldDraft(doc, ref, binding, text, value);
  };
  const revert = () => {
    setFailure(null);
    discardFieldDraft(doc, ref);
  };
  const commit = () => {
    if (!dirty || parsed === null) return;
    const issue = commitFieldDraft(doc, ref);
    setFailure(issue === null ? null : { key, message: issue.message });
  };
  const props = {
    id,
    "aria-label": label,
    "aria-invalid": invalid || mark === "err",
    "aria-describedby": dirty ? `${id}-draft` : undefined,
    className: inputClass(invalid ? "warn" : mark, true),
    value: draft,
    placeholder,
    spellCheck: false,
    title,
    disabled: !doc.writable(),
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(event.target.value),
    onBlur: commit,
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (event.key === "Enter" && (!multiline || event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        commit();
      } else if (event.key === "Escape" && dirty) {
        event.preventDefault();
        event.stopPropagation();
        revert();
      }
    },
  };
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${className}`}>
      {multiline ? <textarea {...props} rows={3} className={`${props.className} h-auto resize-y px-2.5 py-1.5`} /> : <input {...props} autoComplete="off" />}
      {dirty ? (
        <span id={`${id}-draft`} className="flex flex-wrap items-center gap-2 text-small text-ink2">
          {invalid ? (
            <>
              <button type="button" className="inline-flex items-center gap-1 text-warn-ink" onClick={() => openProblems(draftProblemId(doc.id, doc.kind, ref))}>
                <FeedbackIcon level="warning" size={14} /><span className="underline underline-offset-3">Not applied</span>
              </button>
              <button type="button" className="font-medium underline underline-offset-3" onClick={revert}>Revert</button>
              <span>{issue?.message ?? (failure?.key === key ? failure.message : error)}</span>
            </>
          ) : multiline ? "⌘/Ctrl+Enter to apply. Esc to revert." : "Enter to apply. Esc to revert."}
        </span>
      ) : null}
    </div>
  );
}

export function Field({ label, htmlFor, children, path, status }: { label: ReactNode; htmlFor?: string; children: ReactNode; path?: string; status?: ReactNode }) {
  const heading = <>
    <span className="lab text-ink2" title={typeof status === "string" && (status === "Default" || status === "Explicit") ? status : undefined}>{label}</span>
    {status !== undefined && status !== "Default" && status !== "Explicit" ? <span className="text-small text-ink3">{status}</span> : null}
  </>;
  const headingClass = "flex flex-wrap items-baseline gap-x-2 gap-y-0.5";
  return (
    <div className="flex min-w-0 flex-col gap-1" data-path={path}>
      {htmlFor === undefined ? <span className={headingClass}>{heading}</span> : <label htmlFor={htmlFor} className={headingClass}>{heading}</label>}
      {children}
    </div>
  );
}

export function NumberInput({ doc, path, unit, label, placeholder, id }: {
  doc: TextDocument;
  path: Path;
  unit?: string;
  label?: string;
  placeholder?: string;
  id?: string;
}) {
  const meta = useSchema(doc, path);
  const current = doc.value(path);
  const value = (current === null ? "" : typeof current === "string" ? JSON.stringify(current) : doc.raw(path) ?? "").replace(/^-/, "−");
  const node = meta.node?.anyOf?.find((node) => node.type === "integer" || node.type === "number") ?? meta.node;
  const bounds = [
    node?.minimum !== undefined ? `at least ${node.minimum}` : node?.exclusiveMinimum !== undefined ? `greater than ${node.exclusiveMinimum}` : "",
    node?.maximum !== undefined ? `at most ${node.maximum}` : node?.exclusiveMaximum !== undefined ? `less than ${node.exclusiveMaximum}` : "",
  ].filter(Boolean).join(", ");
  const shown = unit ?? meta.unit;
  return (
    <div className="flex min-w-0 items-start gap-1">
      <DraftInput
        doc={doc}
        path={path}
        id={id}
        label={label}
        value={value}
        codec={{
          kind: "number", required: meta.required, integer: node?.type === "integer",
          minimum: node?.minimum, maximum: node?.maximum,
          exclusiveMinimum: node?.exclusiveMinimum, exclusiveMaximum: node?.exclusiveMaximum,
        }}
        error={`Use ${node?.type === "integer" ? "a whole number" : "a finite number"}${bounds ? `, ${bounds}` : ""}${meta.required ? "; this field is required" : ""}.`}
        placeholder={placeholder ?? (doc.kind === "scenario" && current === undefined ? meta.defaultText || "Not set" : undefined)}
        mark={markOf(diagnosticsAt(doc, path))}
        title={meta.description}
        className="flex-1"
      />
      {shown === "" ? null : <span className="flex h-8 items-center rounded-key bg-panel px-2 text-small whitespace-nowrap text-ink2 ring-field">{shown}</span>}
    </div>
  );
}

export function NumberField({ doc, path, label, unit, placeholder, hint }: { doc: TextDocument; path: Path; label: string; unit?: string; placeholder?: string; hint?: ReactNode }) {
  const id = `f-${pathKey(doc.kind, path).replace(/[^\w]/g, "_")}`;
  const diagnostics = diagnosticsAt(doc, path);
  const meta = useSchema(doc, path);
  return (
    <Field label={label} htmlFor={id} path={pathKey(doc.kind, path)} status={meta.source}>
      <NumberInput doc={doc} path={path} unit={unit} placeholder={placeholder} id={id} />
      {hint !== undefined ? <span className="text-small text-ink3">{hint}</span> : null}
      <Messages doc={doc} diagnostics={diagnostics} />
    </Field>
  );
}

export function TextField({ doc, path, label, multiline = false }: { doc: TextDocument; path: Path; label: string; multiline?: boolean }) {
  const id = `f-${pathKey(doc.kind, path).replace(/[^\w]/g, "_")}`;
  const raw = doc.value(path);
  const value = typeof raw === "string" ? raw : raw === undefined ? "" : JSON.stringify(raw);
  const meta = useSchema(doc, path);
  return (
    <Field label={label} htmlFor={id} path={pathKey(doc.kind, path)}>
      <DraftInput
        doc={doc}
        path={path}
        id={id}
        title={meta.description}
        value={value}
        codec={{ kind: "text", required: meta.required, minLength: meta.node?.minLength, maxLength: meta.node?.maxLength, pattern: meta.node?.pattern }}
        multiline={multiline}
        error={meta.description || "Enter a valid value."}
        mark={markOf(diagnosticsAt(doc, path))}
      />
      <Messages doc={doc} diagnostics={diagnosticsAt(doc, path)} />
    </Field>
  );
}

export function JsonValueField({ doc, path, label }: { doc: TextDocument; path: Path; label: string }) {
  const value = doc.value(path);
  const raw = doc.raw(path);
  const text = typeof value === "string" ? JSON.stringify(value) : raw ?? "";
  return (
    <Field label={label} path={pathKey(doc.kind, path)}>
      <DraftInput
        doc={doc}
        path={path}
        label={label}
        value={text}
        multiline
        codec={{ kind: "json" }}
        error="Enter valid JSON, or leave blank to omit."
      />
      <Messages doc={doc} diagnostics={diagnosticsAt(doc, path)} />
    </Field>
  );
}

export function WordSelect({
  doc,
  path,
  label,
  words,
  flat = false,
  aria,
}: {
  doc: TextDocument;
  path: Path;
  label?: string;
  words?: string[];
  flat?: boolean;
  aria?: string;
}) {
  const meta = useSchema(doc, path);
  const list = words ?? (meta.node?.enum ?? []).filter((w) => typeof w === "string");
  const current = doc.value(path);
  const value = typeof current === "string" ? current : current === undefined ? "" : JSON.stringify(current);
  const select = (
    <Select
      flat={flat}
      aria-label={aria ?? label}
      title={meta.description}
      disabled={!doc.writable()}
      value={value}
      onChange={(e) => doc.write(path, e.target.value === "" ? undefined : e.target.value)}
    >
      {value !== "" && !list.includes(value) ? <option value={value}>{value} (unrecognized)</option> : null}
      <option value="">{meta.defaultText === "" ? "Not set" : `Default: ${meta.defaultText}`}</option>
      {list.map((w) => (
        <option key={w} value={w}>{w}</option>
      ))}
    </Select>
  );
  if (label === undefined) return select;
  return (
    <Field label={label} path={pathKey(doc.kind, path)} status={meta.source}>
      {select}
      <Messages doc={doc} diagnostics={diagnosticsAt(doc, path)} />
    </Field>
  );
}

export function BoolToggle({ doc, path, children }: { doc: TextDocument; path: Path; children: ReactNode }) {
  const meta = useSchema(doc, path);
  const current = doc.value(path);
  const checked = typeof current === "boolean" ? current : meta.node?.default === true;
  return (
    <div className="flex flex-col gap-1" data-path={pathKey(doc.kind, path)}>
      <Toggle checked={checked} disabled={!doc.writable()} title={[meta.description, meta.source].filter(Boolean).join(" · ")} onChange={(on) => doc.write(path, on === (meta.node?.default === true) ? undefined : on)}>
        {children}
        {meta.source !== undefined && meta.source !== "Default" && meta.source !== "Explicit" ? <span className="text-small text-ink3">{meta.source}</span> : null}
      </Toggle>
      {current !== undefined && typeof current !== "boolean" ? (
        <code className="text-small text-ink3">Current value: {JSON.stringify(current)}</code>
      ) : null}
      <Messages doc={doc} diagnostics={diagnosticsAt(doc, path)} />
    </div>
  );
}
