# Storage and recovery

LoomSky keeps the workbench in this browser's storage. The web server
serves the application; it does not hold a shared Library. A radio host
receives a prepared bundle when a transmission is submitted and runs
independently of the page.

Changing browser, browser profile or page origin gives a different local
Library. Export a scenario and its inputs when they need to move between
browsers or be kept outside browser storage.

Tabs using the same browser profile and page origin share saved resources,
transmitter registrations, run records and basemap addresses. Committed
changes notify the other tabs to refresh; returning to a tab also refreshes
its stored state if a notification was missed. Each tab keeps its own
current URL and editing interaction.

## What survives reload

| Stored in this browser | Contents |
|---|---|
| Resource heads | the latest saved version of each scenario or trajectory |
| Saved scenario versions | complete JSON, selected filename-to-content bindings and the chosen saved trajectory version/build |
| Saved trajectory versions | complete Library name and Plan JSON |
| Saved builds | source version, engine fingerprint, diagnostics and exact generated PHT or bundle identities |
| Library data files | catalogue names, types, sizes and import times; contents stored by SHA-256 digest |
| Transmitter registrations | addition order, address, token, name, last gain and last observed run summary |
| Submitted runs | saved source version/build identity, frozen scenario and trajectory sources, exact PHT and inputs, bundle and resolved summary; recorded sent bounds and applied-command history when observed |
| Recovery requests | pending submissions, requested cancellation and Stop targets |
| Basemap addresses | archives that opened successfully and have not been removed |
| Shared preferences | theme and map labels |

Documents, files, registrations, run records and basemap addresses use
IndexedDB. Shared preferences use localStorage. Maps open fitted to the
available track and editing geometry. The URL selects the page on reload;
`/` always opens Home. A successful save means the storage transaction has
completed; storage availability and retention remain controlled by the browser.

| Kept only while the page remains open | Consequence of reload |
|---|---|
| Unsaved edits and unapplied inputs | these are lost; choose Save to keep document changes |
| Working-copy checks, generated previews, packs and effective-value results | required results are checked or generated again when the document is opened or used |
| Document undo/redo history | reopening the page starts a new document edit history |
| Background operation progress, active captured inputs and recent results | unfinished work and these records end; already saved imports or copies remain in Library |
| Live host status and current communication state | monitoring reconnects; the last saved observation is only historical context |
| Library search, sorting, selection, scroll and preview state | browsing state starts again |
| Preview time, followed or pinned run, signal selection, view choices, expanded rows and command forms | the page recreates its interface state |
| Problems, Events, the open confirmation, cards and Activity state | those session records disappear; current problems can be projected again |

Saved versions and their build artifacts are retained separately from
temporary working-copy checks. A later build or edit does not replace the
earlier source, diagnostics or exact artifact bytes. The version history
has no fixed length or automatic pruning.

## Working copies and Save

Edits change a working copy in page memory. Choose **Save**, or press
Ctrl+S / Cmd+S in the editor, to save a complete immutable version.
New, imported and duplicated resources start at **v1**. Each Save
appends the next version.
Automatic checking and trajectory generation run for the open editor.
Leaving it releases temporary results; returning prepares them again.
Operations prepare their captured sources separately. Library previews read
saved versions and retained results without starting new checks or solves.

The header shows the saved **vN** and one save state: **Saved**, **Unsaved**, **Saving…** or **Save failed**. Pending input counts as unsaved.
**Saved** describes browser persistence; it does not say that checks passed.
Save first prepares pending fields, the trajectory name, table batch/paste
input, completed drawings and authored timeline ranges. Invalid, conflicting
or incomplete input stays available and blocks saving until corrected or
reverted. Finish or cancel an active drag before saving. The version cannot
silently omit pending input.

Invalid JSON already entered in the JSON editor can be saved as text, and a
Plan or scenario that fails its checks can still have a saved version.

Switching sections or Form/JSON within the same document keeps the working
copy and pending inputs. Leaving an editor with unsaved work shows a small
card at the bottom right: **Save and leave** saves the document before
navigating; **Discard and leave** drops its unsaved edits and unapplied
inputs. If saving fails, the same card stays open for retry or discard.
Incomplete input remains in the editor for correction. Escape dismisses the
card and keeps the editor open. Leaving also cancels an active drag. Reloading or closing the browser page uses the browser’s own unsaved
changes warning. Unsaved editing state is not stored for recovery.

Save finishes only after its storage transaction commits. Edits made while
it is writing remain unsaved. If a save fails, the current edits remain in
page memory. Open **Save failed** or the corresponding problem in Activity
and retry. Each successful Save appends to the resource's saved history.

A working copy without local edits or editing history loads a newer saved
version from another tab automatically. Local edits, unapplied input, undo/redo
history, an active gesture or a save in progress prevent that replacement.
Local work stays in the editor and can be saved as the next version.
A stale rename or removal of a Library file reports the changed record
instead of overwriting it.

A failed Library load also has a problem with **Retry**; it does not mean
the Library is empty.

If a resource cannot load, **View problem** opens the failure. A scenario
whose editor schemas could not load offers **View editor loading
problem**. Host monitoring continues while these editor problems are
resolved.

If another tab replaces the browser database, LoomSky closes its old storage
connection and asks you to reload. The application creates the current schema
for a new Library and opens existing Libraries in that format. Older formats
are not migrated or cleared automatically.

Imports enter Library only after their records and supplied bytes have
been saved. Files are processed individually. A multi-file import can
report a later failure or cancellation after earlier files have succeeded;
those completed entries remain available. Activity lists the result for
each file; select unsuccessful files in a new import to try them again.
Once a storage transaction has started, its committed result is retained
even if cancellation was requested.
Very large inputs can exceed the browser's preparation budget. The operation
reports that limit before reading the input; a refused import creates no
partial version. Use smaller inputs, or wait for other active work to finish
when the message identifies competing tasks.

Choosing a saved trajectory version and successful build changes only the
scenario working copy. Save the scenario to retain that selection. The
saved reference fixes the Plan source and exact PHT; a newer trajectory
version does not update it automatically.

## Version history and restoration

Open the header's **vN** control for **Version history**. Select **Working
copy** to inspect current changes, or a saved version to inspect its
source, changes and dependencies. Every saved version remains
available; saving new content never replaces an earlier entry.

**Restore working copy** loads a historical source into the editor.
If there is unsaved work, review the replacement confirmation first.
Restoration clears unapplied inputs, selections and active interactions,
even when the selected source text matches the working copy. It does not
save or erase later versions. Inspect or edit the restored content, then
choose Save to append a new version. That version
records both its preceding saved version and the version it was restored
from.

Saved source and generated results have separate histories. Builds record
the fingerprint of the trajectory or scenario-packing engine used, along
with diagnostics and artifact contents. Rebuilding does not replace an
earlier artifact with newly generated bytes. Reading a retained result
uses its saved artifacts; it does not rebuild them with the current engine.
A saved scenario keeps the exact trajectory build selected in that version.

## File identities and deletion

A selected file has both a filename and a content digest. The filename is
used by the scenario JSON; the digest selects the bytes. Importing or
typing a matching filename does not bind an unselected file.

Two catalogue entries can have the same name and different contents, or
different names and the same contents. Identical bytes share their
stored content entry. Renaming a Library entry changes that entry's name;
it does not rename references already captured by scenarios or runs.

| Action | Removed | Retained |
|---|---|---|
| Remove an input from a scenario | its reference and any binding no longer used by the scenario | Library entry and bytes; the prior selection remains in the current undo history |
| Remove a Library data-file entry | catalogue metadata | stored bytes, existing scenario bindings and submitted snapshots |
| Delete a scenario or trajectory | Library entry, every saved version and build, and its unsaved working copy | shared stored file bytes; deletion is blocked while saved scenarios or pending/submitted runs use the resource |
| Remove a transmitter registration | saved registration and its preferences | submitted-run records and outstanding recovery persistence work |

Deletion is blocked when a saved scenario version uses the trajectory, or
a pending transmission or submitted run uses the scenario. The failure
identifies the reference that prevents deletion.

Delete confirmation names the resource and states that deletion cannot be
undone. Confirming deletes its saved versions and builds after
outstanding work settles. Shared file bytes remain in browser storage. If
storage fails, the active document remains available and the failure is
reported. Undo restores JSON and selected inputs for ordinary edits in the
current page session; it does not restore a deleted resource.

Removing catalogue entries is not a way to erase every retained copy or
recover all their storage space. Clearing the site's browser data removes
the local Library and run records as well. The storage and transaction
ownership is described in [the workbench design](../design/workbench.md).

## Reload during transmission

Reloading or closing the page does not request Stop and does not cancel
an accepted run. Radio execution belongs to the host. Use the controls in
[transmission](transmission.md) to request a stop and inspect its reported
result.

Before an upload starts, LoomSky saves a submission recovery record. On
reload, it restores saved pending submissions and Stop requests for each
registered address, then polls the host to reconcile their identities.
Reload alone does not turn an uncertain submission into a cancellation.
A previously requested cancellation or Stop continues retrying its
captured operation or run target.

Stop requests are stored separately from transmitter preferences. A Stop
queued while recovery records are loading applies only to submissions
already pending when it was clicked. It does not capture a later
submission just because it uses the same host address.

Completed requests are removed after the host's state establishes their
outcome. Accepted run snapshots and observed results are saved before the
pending submission record is discarded. If an archival or cleanup write
fails, the page keeps retrying that write while the transmitter remains
registered. Removing the registration stops those retries; persisted
recovery records remain available when the address is added again. A run
recovery storage problem says **Keep this page open** because unsaved
recovery work is still in memory.

A stored submission that cannot be read is retained. Problems reports
**Run snapshot unavailable** and offers **Retry loading**. A run
started from another browser can still be monitored, but this browser
does not acquire its missing sources or bundle from the host. Its preview
and download availability is described in [previews](previews.md).

## Exporting and restoring a scenario

Use the scenario's **Export…** action to save a portable ZIP. Export applies
valid pending field text, captures the working content, then checks that
snapshot before producing the archive. Later edits do not replace it.
The archive contains:

| File | Source |
|---|---|
| `scenario.json` | the prepared scenario, with filename-only references |
| adopted trajectory `.pht` | the exact generated bytes adopted by the scenario |
| `trajectory.json` | the adopted editable Plan source |
| named input files | the contents selected by this scenario's bindings |

All files are placed at the ZIP root. The PHT uses the scenario's trajectory
reference stem; the Plan source is `trajectory.json`. Export stops if a
required file is missing or two different contents would use the same
output filename. It reads the selected saved trajectory version and build,
even when the shared trajectory has newer saved versions or unsaved edits.

To restore it:

1. Extract the ZIP outside LoomSky.
2. In Library, choose **Import → Scenario JSON…** for the scenario file.
3. Choose **Import → Trajectory JSON…** for `trajectory.json`. Open the
   imported Plan and wait for its current result to pass verification.
4. Upload the navigation, antenna and precise-product files through
   **Import → Data file…**, or through their scenario pickers.
5. In Setup, select the trajectory through **Choose…** and
   choose its saved **v1**, then **Use v1**. In Data, choose each
   named input explicitly.
6. Review the restored scenario's checks and previews, then choose **Save**
   to retain its selected inputs.

The ZIP retains the exact compiled PHT used by the exported scenario.
Restoring through the authoring workflow solves the Plan again and adopts
that new verified result; it does not import the archived PHT as source.
Review the regenerated path before use.

The ZIP restores a scenario's inputs through the normal import workflow.
It does not contain other Library resources, their saved version histories,
transmitter tokens, submitted run history, pending requests, preferences or
undo history. An export is an independent copy once downloaded; browser
storage alone is not that copy.

Data-file, scenario ZIP and modeled observation/position exports use temporary
browser storage while they are being generated, then request the completed
download. Cancelling or failing the export removes its temporary output.
If browser storage is full, or the browser cannot accommodate a large
export, Activity reports the cause; free storage or choose a smaller output
range before retrying.
