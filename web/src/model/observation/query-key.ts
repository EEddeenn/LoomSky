import type { ObsCommand } from "./commands";

export function commandInputs(commands: readonly ObsCommand[]) {
  return commands.map((command) => command.kind === "signal_power"
    ? [command.epoch, command.kind, command.system, command.svid, command.level?.unit ?? null, command.level?.value ?? null]
    : [command.epoch, command.kind, command.value]);
}
