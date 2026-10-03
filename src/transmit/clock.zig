const std = @import("std");
const Io = std.Io;
const core = @import("core");
const Plan = @import("plan.zig").Plan;
const Duration = Io.Duration;
const GpsTime = core.time.GpsTime;
const Reference = core.host.Reference;
const Locks = core.device.Locks;
const At = core.device.At;
const Outcome = core.status.Outcome;
const ns_per_s = core.time.ns_per_s;

const lock_wait: Duration = .fromSeconds(10);
const edge_wait: Duration = .fromMilliseconds(1100);
pub const watch_interval: Duration = .fromSeconds(1);
const lock_poll: Duration = .fromMilliseconds(100);
const edge_poll: Duration = .fromMilliseconds(5);
const no_edge = std.fmt.comptimePrint("no PPS edge within {d} ms", .{edge_wait.toMilliseconds()});

fn holds(reference: Reference, locks: Locks) bool {
    return switch (reference) {
        .none => true,
        .external => locks.ref,
        .gpsdo => locks.ref and locks.gps,
    };
}

fn nextEdge(t: GpsTime) GpsTime {
    return .{ .ns = (@divFloor(t.ns + ns_per_s / 2, ns_per_s) + 1) * ns_per_s };
}

pub fn set(radio: anytype, plan: Plan) ?Outcome {
    const reference = radio.host.station.reference;
    if (reference != .none) if (awaitLocks(radio, reference)) |outcome| return outcome;
    if (plan.clock == .replay) return null;
    if (reference != .none) return latch(radio, plan.leap);
    radio.call(.set_time, .{At{ .now = GpsTime.host(radio.control.io, plan.leap) }}) catch return radio.lost(.clock);
    return null;
}

pub fn watch(radio: anytype, next: *Io.Clock.Timestamp) ?Outcome {
    const reference = radio.host.station.reference;
    if (reference == .none or !radio.passed(next.*)) return null;
    next.* = radio.deadline(watch_interval);
    const locks = radio.call(.locked, .{}) catch return radio.lost(.device);
    if (holds(reference, locks)) return null;
    var buffer: [96]u8 = undefined;
    return radio.failed(.clock, std.fmt.bufPrint(&buffer, "the {s} reference lost its lock on air", .{@tagName(reference)}) catch "the reference lost its lock on air");
}

fn awaitLocks(radio: anytype, reference: Reference) ?Outcome {
    const deadline = radio.deadline(lock_wait);
    while (true) {
        if (radio.stopped()) return .stopped;
        const locks = radio.call(.locked, .{}) catch return radio.lost(.device);
        if (holds(reference, locks)) return null;
        if (radio.passed(deadline)) {
            var buffer: [96]u8 = undefined;
            return radio.failed(.clock, std.fmt.bufPrint(&buffer, "the {s} reference did not lock within {d} s", .{ @tagName(reference), lock_wait.toSeconds() }) catch "the reference did not lock");
        }
        radio.pause(lock_poll);
    }
}

fn latch(radio: anytype, leap: core.time.Leap) ?Outcome {
    const before = radio.call(.last_pps, .{}) catch return radio.lost(.device);
    switch (awaitEdge(radio, before, null)) {
        .edge => {},
        .outcome => |outcome| return outcome,
        .none => return radio.failed(.clock, no_edge),
    }
    const second = nextEdge(GpsTime.host(radio.control.io, leap));
    radio.call(.set_time, .{At{ .next_pps = second }}) catch return radio.lost(.clock);
    const edge = radio.call(.last_pps, .{}) catch return radio.lost(.device);
    if (edge.ns == second.ns) return null;
    switch (awaitEdge(radio, edge, second)) {
        .edge => return null,
        .outcome => |outcome| return outcome,
        .none => {
            const read = radio.call(.last_pps, .{}) catch return radio.lost(.device);
            var buffer: [96]u8 = undefined;
            return radio.failed(.clock, std.fmt.bufPrint(&buffer, "the PPS latch read back {d} s, not {d} s", .{
                @divFloor(read.ns, ns_per_s), @divFloor(second.ns, ns_per_s),
            }) catch "the PPS latch did not take");
        },
    }
}

const Edge = union(enum) { edge, none, outcome: Outcome };

fn awaitEdge(radio: anytype, previous: GpsTime, wanted: ?GpsTime) Edge {
    const deadline = radio.deadline(edge_wait);
    while (!radio.passed(deadline)) {
        if (radio.stopped()) return .{ .outcome = .stopped };
        const last = radio.call(.last_pps, .{}) catch return .{ .outcome = radio.lost(.device) };
        if (last.ns != previous.ns) return if (wanted == null or last.ns == wanted.?.ns) .edge else .none;
        radio.pause(edge_poll);
    }
    return .none;
}
