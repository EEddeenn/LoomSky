import { NavLink } from "@/page/shared/navigation";

export function HomeWorkspace() {
  return (
    <section aria-labelledby="home-title" className="flex min-h-0 flex-1 flex-col overflow-auto bg-face p-6">
      <div className="m-auto w-full max-w-lg py-12">
        <h1 id="home-title" className="m-0 font-cond text-d1 font-semibold">LoomSky</h1>
        <p className="mt-3 mb-6 text-ink2">Build GNSS scenarios. Preview signals. Control radio hosts.</p>
        <NavLink destination={{ workspace: "library" }} className="inline-flex h-9 items-center justify-center rounded-key bg-primary px-4 font-medium text-on-primary [box-shadow:var(--primary-ring)] hover:bg-primary-hover">
          Open Library
        </NavLink>
      </div>
    </section>
  );
}
