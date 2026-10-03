const std = @import("std");
const Io = std.Io;
const core = @import("core");
const Control = @import("control.zig").Control;
const status = core.status;
const device = core.device;
const Duration = Io.Duration;
const Outcome = status.Outcome;
const Operation = device.Operation;

pub const send_timeout: Duration = .{ .nanoseconds = @import("ring.zig").lead.nanoseconds + std.time.ns_per_s };

const Busy = packed struct(u64) {
    active: bool = false,
    op: Operation = .open,
    since_ms: u59 = 0,
};

pub fn Radio(comptime Device: type) type {
    comptime device.check(Device);
    return struct {
        const Self = @This();

        control: Control,
        host: *const core.host.Host,
        device: *Device,
        open: bool = false,
        call_in_progress: std.atomic.Value(Busy) = .init(.{}),

        pub fn init(io: Io, gpa: std.mem.Allocator, host: *const core.host.Host, boot: u64, dev: *Device) Self {
            return .{ .control = .init(io, gpa, boot), .host = host, .device = dev };
        }

        fn Result(comptime op: Operation) type {
            return @typeInfo(device.Signature(Device, op)).@"fn".return_type.?;
        }

        pub fn call(self: *Self, comptime op: Operation, args: anytype) Result(op) {
            const since = Io.Clock.awake.now(self.control.io).toMilliseconds();
            self.call_in_progress.store(.{ .active = true, .op = op, .since_ms = @intCast(since) }, .release);
            defer self.call_in_progress.store(.{}, .release);
            return @call(.auto, @field(Device, device.method(op)), .{self.device} ++ args);
        }

        pub fn busy(self: *Self) ?device.Call {
            const active_call = self.call_in_progress.load(.acquire);
            if (!active_call.active) return null;
            return .{
                .name = @tagName(active_call.op),
                .since = .{
                    .raw = .fromNanoseconds(@as(i96, active_call.since_ms) * std.time.ns_per_ms),
                    .clock = .awake,
                },
            };
        }

        pub fn deadline(self: *Self, after: Duration) Io.Clock.Timestamp {
            return .fromNow(self.control.io, .{ .raw = after, .clock = .awake });
        }

        pub fn passed(self: *Self, moment: Io.Clock.Timestamp) bool {
            return moment.compare(.lte, .now(self.control.io, .awake));
        }

        pub fn pause(self: *Self, span: Duration) void {
            self.control.io.sleep(span, .awake) catch return;
        }

        pub fn stopped(self: *Self) bool {
            self.control.lock();
            defer self.control.unlock();
            return self.control.stop;
        }

        fn setDevice(self: *Self, state: status.DeviceState) void {
            self.control.lock();
            defer self.control.unlock();
            self.control.device = state;
        }

        pub fn openDevice(self: *Self) bool {
            self.setDevice(.opening);
            self.call(.open, .{&self.host.station}) catch |e| {
                self.setDevice(switch (e) {
                    error.Absent => .absent,
                    error.Device => .failed,
                });
                return false;
            };
            self.open = true;
            self.setDevice(.ready);
            return true;
        }

        pub fn drop(self: *Self) void {
            self.call(.close, .{});
            self.open = false;
            self.setDevice(.failed);
        }

        pub fn failed(self: *Self, reason: status.Reason, message: []const u8) Outcome {
            self.control.lock();
            defer self.control.unlock();
            self.control.closeCommands();
            return .{ .failed = .{ .reason = reason, .message = self.control.keep(message) } };
        }

        pub fn lost(self: *Self, reason: status.Reason) Outcome {
            return self.failed(reason, self.device.failure());
        }

        pub fn endBurst(self: *Self) ?Outcome {
            _ = self.call(.send, .{ &.{}, device.Burst.end, send_timeout }) catch return self.lost(.send);
            return null;
        }

        pub fn drain(self: *Self) error{Device}!void {
            while (try self.call(.event, .{}) != null) {}
        }
    };
}
