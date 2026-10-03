const std = @import("std");
const Io = std.Io;
const core = @import("core");
const ring = @import("ring.zig");
const clock = @import("clock.zig");
const Plan = @import("plan.zig").Plan;
const Taken = @import("control.zig").Taken;
const send_timeout = @import("radio.zig").send_timeout;
const status = core.status;
const device = core.device;
const GpsTime = core.time.GpsTime;
const Epoch = core.time.Epoch;
const Outcome = status.Outcome;

const ack_wait: Io.Duration = .fromSeconds(1);
const ack_poll: Io.Duration = .fromMilliseconds(5);
const hold_step: Io.Duration = .fromMilliseconds(10);

const Fault = enum { underflow, late, sequence, short };
const Ended = union(enum) { fault, outcome: Outcome };

pub fn air(radio: anytype) Outcome {
    radio.control.lock();
    const handoff = radio.control.awaitPlan();
    radio.control.unlock();
    const plan = switch (handoff) {
        .outcome => |outcome| return outcome,
        .ready => |p| p,
    };

    if (!radio.open and !radio.openDevice()) return radio.lost(.device);
    const readback = radio.call(.tune, .{plan.settings}) catch {
        const outcome = radio.lost(.device);
        radio.drop();
        return outcome;
    };

    const outcome = tuned(radio, plan, readback);
    radio.control.lock();
    radio.control.closeCommands();
    radio.control.unlock();
    radio.call(.untune, .{});
    switch (outcome) {
        .failed => |f| if (f.reason == .device or f.reason == .send) radio.drop(),
        else => {},
    }
    return outcome;
}

fn tuned(radio: anytype, plan: Plan, readback: device.Readback) Outcome {
    var buffer: [256]u8 = undefined;
    var why: []const u8 = "";
    plan.check(readback, &buffer, &why) catch return radio.failed(.readback, why);

    if (radio.endBurst()) |outcome| return outcome;
    radio.drain() catch return radio.lost(.device);

    radio.control.lock();
    radio.control.current().plan = .{ .readback = readback, .window = plan.window, .leap = plan.leap };
    radio.control.unlock();

    if (clock.set(radio, plan)) |outcome| return outcome;
    return entries(radio, plan);
}

fn entries(radio: anytype, plan: Plan) Outcome {
    const window = plan.window;
    var replay: ?GpsTime = switch (plan.clock) {
        .replay => |t| t,
        .live => null,
    };
    var watch = radio.deadline(clock.watch_interval);
    while (true) {
        const entry_time = replay orelse (radio.call(.now, .{}) catch return radio.lost(.device));
        const target = window.entry(entry_time, ring.lead) orelse return .completed;
        const slot = switch (take(radio, target)) {
            .slot => |s| s,
            .stopped => return .stopped,
            .failed => |f| return .{ .failed = f },
        };
        if (slot.epochs == 0) {
            give(radio, slot);
            return .completed;
        }

        if (replay) |replay_time| {
            radio.call(.set_time, .{device.At{ .now = replay_time }}) catch {
                give(radio, slot);
                return radio.lost(.clock);
            };
            replay = null;
        }

        const start = window.air(slot.first);
        const now = radio.call(.now, .{}) catch {
            give(radio, slot);
            return radio.lost(.device);
        };
        if (now.order(start.sub(ring.slot_span)) == .gt) {
            recordFault(radio, .late);
            give(radio, slot);
            continue;
        }
        if (hold(radio, start.sub(ring.lead), window.start)) |outcome| {
            give(radio, slot);
            return outcome;
        }
        radio.drain() catch {
            give(radio, slot);
            return radio.lost(.device);
        };
        switch (burst(radio, slot, start, &watch)) {
            .fault => {},
            .outcome => |outcome| return outcome,
        }
    }
}

fn burst(radio: anytype, first: *ring.Slot, start: GpsTime, watch: *Io.Clock.Timestamp) Ended {
    var slot = first;
    var kind: device.Burst = .{ .start = start };
    while (true) {
        const bytes = slot.aired();
        const sent = radio.call(.send, .{ bytes, kind, send_timeout }) catch {
            give(radio, slot);
            return .{ .outcome = radio.lost(.send) };
        };
        if (sent < bytes.len) {
            give(radio, slot);
            return fault(radio, .short);
        }
        kind = .middle;
        aired(radio, slot);

        while (radio.call(.event, .{}) catch return .{ .outcome = radio.lost(.device) }) |event| switch (event) {
            .ack => {},
            .underflow => return fault(radio, .underflow),
            .late => return fault(radio, .late),
            .sequence => return fault(radio, .sequence),
        };
        if (clock.watch(radio, watch)) |outcome| return .{ .outcome = radio.endBurst() orelse outcome };

        slot = switch (take(radio, null)) {
            .slot => |s| s,
            .stopped => return .{ .outcome = finish(radio) orelse .stopped },
            .failed => |f| return .{ .outcome = radio.endBurst() orelse .{ .failed = f } },
        };
        if (slot.epochs == 0) {
            give(radio, slot);
            return .{ .outcome = finish(radio) orelse .completed };
        }
    }
}

fn fault(radio: anytype, kind: Fault) Ended {
    recordFault(radio, kind);
    if (radio.endBurst()) |outcome| return .{ .outcome = outcome };
    return .fault;
}

fn recordFault(radio: anytype, kind: Fault) void {
    radio.control.lock();
    defer radio.control.unlock();
    const counts = &radio.control.current().counts;
    switch (kind) {
        .underflow => counts.underflow += 1,
        .late => counts.late += 1,
        .sequence => counts.sequence += 1,
        .short => counts.short += 1,
    }
}

fn finish(radio: anytype) ?Outcome {
    if (radio.endBurst()) |outcome| return outcome;
    const deadline = radio.deadline(ack_wait);
    while (!radio.passed(deadline)) {
        while (radio.call(.event, .{}) catch return radio.lost(.device)) |event| switch (event) {
            .ack => return null,
            .underflow => recordFault(radio, .underflow),
            .late => recordFault(radio, .late),
            .sequence => recordFault(radio, .sequence),
        };
        radio.pause(ack_poll);
    }
    return null;
}

fn hold(radio: anytype, until: GpsTime, start: GpsTime) ?Outcome {
    while (true) {
        if (radio.stopped()) return .stopped;
        const now = radio.call(.now, .{}) catch return radio.lost(.device);
        if (now.order(until) != .lt) return null;
        if (now.order(start) == .lt) {
            radio.control.lock();
            radio.control.current().state = .waiting;
            radio.control.unlock();
        }
        radio.pause(.{ .nanoseconds = @min(until.ns - now.ns, hold_step.nanoseconds) });
    }
}

fn take(radio: anytype, target: ?Epoch) Taken {
    radio.control.lock();
    defer radio.control.unlock();
    if (target) |e| {
        radio.control.current().state = .starting;
        radio.control.enter(e);
    }
    return radio.control.take();
}

fn give(radio: anytype, slot: *ring.Slot) void {
    radio.control.lock();
    defer radio.control.unlock();
    radio.control.release(slot);
}

fn aired(radio: anytype, slot: *ring.Slot) void {
    radio.control.lock();
    defer radio.control.unlock();
    const current = radio.control.current();
    if (current.first == null) current.first = slot.first;
    current.sent = slot.last();
    current.channels = slot.channels;
    current.counts.clipped += slot.clipped;
    current.state = .on_air;
    radio.control.release(slot);
}
