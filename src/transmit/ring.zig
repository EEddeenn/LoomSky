const std = @import("std");
const core = @import("core");
const Epoch = core.time.Epoch;
const Channels = core.status.Channels;

const slots = 4;
pub const slot_epochs = 50;
pub const slot_span = core.time.span(slot_epochs);
pub const lead = core.time.span(slots * slot_epochs);

pub const Slot = struct {
    bytes: []u8,
    state: enum { free, filling, full, sending } = .free,
    seq: u64 = 0,
    first: Epoch = .of(0),
    epochs: u32 = 0,
    clipped: u64 = 0,
    channels: Channels = .{},

    pub fn aired(slot: *const Slot) []const u8 {
        return slot.bytes[0 .. slot.bytes.len / slot_epochs * slot.epochs];
    }

    pub fn last(slot: *const Slot) Epoch {
        return slot.first.plus(slot.epochs - 1);
    }
};

pub const Ring = struct {
    memory: []u8,
    slots: [slots]Slot,
    generation: u32 = 0,
    target: Epoch = .of(0),
    seq: u64 = 0,

    pub fn init(gpa: std.mem.Allocator, bytes_per_epoch: usize) error{OutOfMemory}!Ring {
        const size = bytes_per_epoch * slot_epochs;
        const memory = try gpa.alloc(u8, size * slots);
        var ring: Ring = .{ .memory = memory, .slots = undefined };
        for (&ring.slots, 0..) |*slot, i| slot.* = .{ .bytes = memory[i * size ..][0..size] };
        return ring;
    }

    pub fn deinit(ring: *Ring, gpa: std.mem.Allocator) void {
        gpa.free(ring.memory);
    }

    pub fn enter(ring: *Ring, target: Epoch) void {
        ring.generation +%= 1;
        ring.target = target;
        for (&ring.slots) |*slot| if (slot.state == .full) {
            slot.state = .free;
        };
    }

    pub fn claim(ring: *Ring) ?*Slot {
        for (&ring.slots) |*slot| if (slot.state == .free) {
            slot.state = .filling;
            return slot;
        };
        return null;
    }

    pub fn publish(ring: *Ring, slot: *Slot, generation: u32) void {
        if (generation != ring.generation) {
            slot.state = .free;
            return;
        }
        slot.state = .full;
        slot.seq = ring.seq;
        ring.seq += 1;
    }

    pub fn take(ring: *Ring) ?*Slot {
        var next: ?*Slot = null;
        for (&ring.slots) |*slot| {
            if (slot.state != .full) continue;
            if (next == null or slot.seq < next.?.seq) next = slot;
        }
        if (next) |slot| slot.state = .sending;
        return next;
    }

    pub fn release(slot: *Slot) void {
        slot.state = .free;
    }
};
