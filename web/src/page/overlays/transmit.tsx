"use client";

import { useStore } from "@/core";
import { libraryPicker } from "@/workbench/library";
import { transmission } from "@/workbench/transmit";
import { Configuration } from "./transmit/configuration";

export function TransmitDialog() {
  const session = useStore(transmission, ({ state }) => state.kind === "configuring" ? state.session : null);
  const picking = useStore(libraryPicker, (state) => state.session !== null);
  return session === null ? null : <div hidden={picking}><Configuration key={session.id} session={session} /></div>;
}
