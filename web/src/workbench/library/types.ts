import type { ResourceRef } from "@/model/resource";

export type LibraryKind = ResourceRef["kind"];
export type LibraryFilter = "all" | LibraryKind;
export type LibrarySort = "name" | "type" | "status";
