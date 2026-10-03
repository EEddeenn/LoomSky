const std = @import("std");
const time = @import("time.zig");
const device = @import("device.zig");
const Station = @import("host.zig").Station;
const Config = @import("config.zig").Config;
const Command = @import("command.zig").Command;
const types = @import("pharos_run").core.types;
const identity = @import("identity.zig");

const Signal = types.Signal;

pub const Channels = struct {
    bits: std.StaticBitSet(signals * satellites) = .initEmpty(),

    const signals = @typeInfo(Signal).@"enum".fields.len;
    const satellites = 64;

    pub fn set(self: *Channels, key: types.ChannelKey, on: bool) void {
        self.bits.setValue(@as(usize, @intFromEnum(key.signal)) * satellites + key.sat.prn(), on);
    }

    pub fn jsonStringify(self: Channels, jw: anytype) !void {
        try jw.beginArray();
        var it = self.bits.iterator(.{});
        while (it.next()) |i| {
            const signal: Signal = @enumFromInt(i / satellites);
            try jw.write(.{ .system = signal.system().name(), .svid = i % satellites, .signal = signal.name() });
        }
        try jw.endArray();
    }
};

pub const DeviceState = enum { opening, ready, absent, failed };
const State = enum { starting, waiting, on_air, ended };
pub const Reason = enum { bundle, format, band, gain, window, device, readback, clock, send, generator, host };
pub const Failure = struct { reason: Reason, message: []const u8 };
pub const Outcome = union(enum) { completed, stopped, refused: Failure, failed: Failure };

const Counts = struct {
    underflow: u64 = 0,
    late: u64 = 0,
    sequence: u64 = 0,
    short: u64 = 0,
    clipped: u64 = 0,
};

pub const Discarded = enum { completed, stopped, refused, failed };
const Applied = union(enum) { epoch: time.Epoch, rejected: []const u8, discarded: Discarded };
pub const Record = struct {
    actionId: []const u8,
    command: Command,
    applied: ?Applied = null,

    pub fn writeReceipt(self: Record, target: identity.RunId, w: *std.Io.Writer) std.Io.Writer.Error!void {
        const state: enum { accepted, applied, rejected, discarded } = if (self.applied) |result| switch (result) {
            .epoch => .applied,
            .rejected => .rejected,
            .discarded => .discarded,
        } else .accepted;
        try std.json.Stringify.value(.{
            .target = target,
            .actionId = self.actionId,
            .command = self.command,
            .state = state,
            .applied = self.applied,
        }, .{}, w);
    }
};

const Shown = struct {
    readback: device.Readback,
    window: time.Window,
    leap: time.Leap,

    pub fn jsonStringify(self: Shown, jw: anytype) !void {
        const start = self.window.start.ns;
        try jw.write(.{
            .rate_hz = self.readback.rate.hz,
            .centre_hz = self.readback.centre.hz,
            .gain_db = self.readback.gain.db,
            .start_gps_ms = @divFloor(start, time.ns_per_ms),
            .start_gps_sub_ms = @as(f64, @floatFromInt(@mod(start, time.ns_per_ms))) / time.ns_per_ms,
            .epochs = self.window.epochs,
            .leap_seconds = self.leap.seconds,
            .leap_change_gps_ms = if (self.leap.change) |c| @divFloor(c.ns, time.ns_per_ms) else null,
            .leap_seconds_after = self.leap.seconds_after,
        });
    }
};

pub const Status = struct {
    state: State = .starting,
    outcome: ?Outcome = null,
    config: Config,
    plan: ?Shown = null,
    first: ?time.Epoch = null,
    sent: ?time.Epoch = null,
    counts: Counts = .{},
    channels: Channels = .{},
    commands: []const Record = &.{},
};

pub const Operation = struct {
    id: identity.OperationId,
    state: union(enum) { uploading, accepted: identity.RunId, cancelled, rejected },

    pub fn jsonStringify(self: Operation, jw: anytype) !void {
        try jw.write(.{
            .id = self.id,
            .state = std.meta.activeTag(self.state),
            .target = switch (self.state) {
                .accepted => |target| target,
                else => null,
            },
        });
    }
};

pub const Snapshot = struct {
    boot: identity.Boot,
    run: u64,
    operation: ?Operation,
    device: DeviceState,
    station: *const Station,
    now_ms: i64,
    status: ?*const Status,

    pub fn write(self: Snapshot, w: *std.Io.Writer) std.Io.Writer.Error!void {
        try std.json.Stringify.value(.{
            .boot = self.boot,
            .run = self.run,
            .operation = self.operation,
            .device = self.device,
            .station = .{
                .name = self.station.name,
                .bands_hz = self.station.bands_hz,
                .max_gain_db = self.station.max_gain_db,
                .reference = self.station.reference,
            },
            .now_ms = self.now_ms,
            .status = self.status,
        }, .{}, w);
    }
};
