# Activity

Activity holds current problems, event history and background operations
for this page session. Corner cards show urgent problems, the current
confirmation and the latest result message.

Choose **Activity** in the top bar. Its button shows the current problem
count when nonzero and marks an open confirmation as **1 pending**. The
sidebar has **Problems** and **Events** tabs, with **Operations** above
either tab when present.

| Record | Holds | Lifetime |
|---|---|---|
| problem | a current error or warning, its explanation and recovery actions | until the condition clears, or an operation failure is dismissed |
| event | a historical action, warning, alarm, result or notice | until **Clear log** or the end of the page session |
| confirmation | a reviewed action waiting for an explicit decision | until cancelled or execution finishes; reload discards an unstarted request |
| operation | an import, duplicate or export with its progress and result | while running and among the 50 most recent completed operations; reload clears these records |
| corner card | an urgent-problem summary, the current confirmation or the latest message | until the condition clears, the confirmation ends, or the message is replaced or dismissed |

The implementation and ownership of these records are described in
[the browser workbench](../design/workbench.md).

## Operations

**Operations** shows running and recently finished imports, duplication
and exports, including observation and position files. Each entry shows
its phase, progress when available, and **Cancel** while cancellation is
available. Switching resources, closing a picker or closing Activity leaves
the operation running. Later edits and transmitter progress do not replace
its captured source or range.

Imports list each file's result, distinguish newly created resources from
reused Library entries, and offer links to available resources.
Some files can succeed while others fail or remain unfinished. To try an
import again, select the unsuccessful files in a new import. Start a failed
or cancelled duplication or export again from its source. Completed records
retain their results and explanations; captured inputs are released when
the operation ends.

**Cancel** stops reading or computation at its next cancellation check.
An import already saving a resource finishes that save, keeps its result
and stops before the next file. Completed imports and copies remain in
Library. Cancelling an export before its download is requested produces no
partial download; its temporary output is discarded. Once the result is
being committed, cancellation is no longer offered where it cannot stop
that result.

An export result says **Download requested** and gives the filename and byte
count. This means the file was handed to the browser; the browser controls
where it is saved. Successes and cancellations appear in **Events** and
failures in **Problems**. See [output files](previews.md#output-files) for
the inputs captured by modeled exports.

## Review a problem

**Problems** groups errors and warnings by scenario, trajectory,
transmitter or operation. Each entry shows a title, full explanation,
location when available, and the actions that apply to that condition.
Within each group, urgent entries appear first, then errors, then
warnings, with newer entries first within each class. Groups are ordered
by their highest-ranked entry.

Use **All**, **Errors** or **Warnings** to filter the list. A **View
problem** cue in a field, preview or status opens the matching entry,
restores the **All** filter, scrolls it into view and gives it focus.

| Action | Effect |
|---|---|
| **Locate**, when offered | opens or focuses the affected document or field |
| **Retry**, **Retry loading**, or another recovery action | retries the named operation |
| **Dismiss**, when offered | removes a retained, nonurgent operation failure |

Correcting a condition removes its problem automatically. A condition
still reported by a document, radio or other part of the page has no
generic **Dismiss** action. Its own recovery controls determine when it
clears.

Urgent radio conditions are marked **Needs action**; their meaning and
recovery are in [transmission](transmission.md).

A recovery button shows **Working…** while its action runs. If that
action fails, Activity records the failure with its explanation. An
empty filtered list says **No matching problems**; **No current
problems** means there are no problems in any level.

## Corner cards

Cards appear near the lower-right corner. Opening Activity moves them
beside the sidebar so both remain accessible.

| Card | Behavior |
|---|---|
| urgent problems | a summary remains while urgent conditions exist; **View problem(s)** opens Activity and recovery actions apply to the first listed problem |
| confirmation | one reviewed action with **Cancel** and its named action button |
| message | the latest completion or notice; **Dismiss message** closes it and a new message replaces it |

These cards can appear together. Nonurgent problems are listed in Activity.
Closing a message or resolving a problem leaves its event history available.

## Confirm an action

Deleting, removing or replacing resource content can open a confirmation
card with a target, explanation and relevant details. Read those details
before using its named action button, such as **Delete scenario** or
**Remove from Library**. Transmission has its own
[review step](transmission.md#review-and-transmit) in the transmission dialog.

Only one confirmation can be open at a time. Finish or cancel it before
reviewing another action.

| Control | Effect |
|---|---|
| the named action button | executes the reviewed action once |
| **Cancel** | closes an unstarted confirmation |
| **Escape**, when the confirmation has focus | cancels an unstarted confirmation |

While execution is in progress, the buttons are disabled and the action
shows **Working…**. Closing Activity leaves the confirmation visible.
A resource changed after review requires a fresh review. A rejected or
failed action closes its confirmation and records a problem; review the
current target before trying again.

Confirmations never execute automatically. Reloading discards an unstarted
confirmation. A transmission that has already been sent has its own lifetime
and recovery state; use the [transmission controls](transmission.md#stop) to
stop it.

## Events and the log

**Events** lists actions, alarms, warnings, results and notices from
this page load, newest first. Each entry includes GPS and UTC times.
An entry associated with a still-current problem offers **View current
problem**. Resolving a problem leaves its earlier event in the history.

| Control | Effect |
|---|---|
| **Download log** | saves `loomsky-events.txt`, with events in chronological order and GPS/UTC times |
| **Clear log** | removes the event history; disabled when it is empty |

Clearing the log leaves current problems, the open confirmation and
cards intact. Download the log before clearing it or reloading
if that history needs to be kept.

## Session state and radio summary

Closing and reopening Activity keeps its selected tab, Problems filter
and scroll positions. Switching between Problems and Events keeps each
view's position. These views and feedback records
live in memory for the page session; [storage](storage.md) lists the
state that survives reload.

The browser tab title summarizes radio-host classes, for example
`1 on air · 1 unknown · LoomSky`. It counts on-air, armed, unknown and
alarm hosts. The favicon uses the first present class in this order:
unknown, alarm, on air, armed, off. These are the same host states used
by the [host strip](transmission.md#read-the-host-strip).
