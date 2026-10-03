"use client";

import { canStop, chipLabel, offGlyph, type hostView, type Host, type HostClass } from "@/workbench/hosts";
import { stopHost } from "@/workbench/hosts/actions";
import { NavLink } from "@/page/shared/navigation";
import { Fig, Icon, type IconName } from "@/page/shared/ui";

const looks: Record<HostClass, string> = {
  onair: "bg-rf text-on-rf",
  armed: "bg-face outline-2 -outline-offset-2 outline-rf-mark",
  unknown: "bg-face outline-2 -outline-offset-2 outline-dashed outline-rf-mark",
  alarm: "bg-face outline-2 -outline-offset-2 outline-fault",
  off: "bg-transparent ring-key",
};

function glyph(h: Host, cls: HostClass) {
  if (cls === "onair") return <span className="inline-block size-2.5 flex-none rounded-full bg-on-rf" />;
  const name: IconName = cls === "armed" ? "clock" : cls === "unknown" ? "unknown" : cls === "alarm" ? "alert" : offGlyph(h);
  return <Icon name={name} size={14} />;
}

export function Chip({ host, name, text: t, refused, selected }: {
  host: Host;
  name: string;
  text: ReturnType<typeof hostView>["chip"];
  refused: boolean;
  selected: boolean;
}) {
  const tone = t.cls === "onair" ? ""
    : t.cls === "alarm" ? "text-fault"
    : t.cls === "off" ? (refused ? "text-warn-ink" : "text-ink3")
    : "text-rf-ink";
  const word = t.cls === "off" && !refused
    ? (t.word === "idle" ? null : <span className="text-body text-ink2">{t.word}</span>)
    : <span className={`lab ${tone}`}>{t.word}</span>;
  return (
    <div
      role="group"
      aria-label={chipLabel(name, t)}
      className={`relative inline-flex h-9 flex-none items-stretch rounded-key ${looks[t.cls]} ${selected ? "after:absolute after:right-0 after:-bottom-1.5 after:left-0 after:h-0.5 after:bg-ink after:content-['']" : ""}`}
    >
      <NavLink
        aria-current={selected ? "page" : undefined}
        title={host.record.address}
        resource={{ kind: "host", key: host.key }}
        className={`inline-flex h-full items-center gap-2 rounded-key pr-3 pl-2.5 whitespace-nowrap ${t.cls === "onair" ? "hover:bg-rf-deep" : "hover:bg-hover"}`}
      >
        <span className={`grid flex-none place-items-center ${tone}`}>{glyph(host, t.cls)}</span>
        <span className="font-semibold">{name}</span>
        {word}
        {t.figure !== "" ? (
          <span className="text-body font-medium">
            {t.lead !== "" ? <span className="text-small font-normal">{t.lead}</span> : null}
            <Fig>{t.figure}</Fig>
            {t.tail !== "" ? <span className={`text-small font-normal ${t.cls === "onair" ? "" : "text-ink2"}`}>{t.tail}</span> : null}
          </span>
        ) : null}
      </NavLink>
      {canStop(host, Date.now()) ? (
        <button
          type="button"
          aria-label={`Stop ${name}${host.stop?.queued === true ? " (queued)" : ""}`}
          title={`Stop ${name}`}
          onClick={() => stopHost(host.key)}
          className={`grid w-9 flex-none place-items-center rounded-r-key ${t.cls === "onair" ? "text-on-rf shadow-[inset_1px_0_0_var(--rf-line)] hover:bg-rf-deep" : "text-rf-mark shadow-[inset_1px_0_0_var(--line2)] hover:bg-hover"}`}
        >
          <Icon name="stop" size={12} />
        </button>
      ) : null}
    </div>
  );
}
