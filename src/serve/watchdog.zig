const std = @import("std");
const builtin = @import("builtin");
const Io = std.Io;
const console = @import("core").console;

const tick_interval: Io.Duration = .fromSeconds(1);
const busy_limit: Io.Duration = .fromSeconds(30);
const stop_limit: Io.Duration = .fromSeconds(5);

var signalled: std.atomic.Value(bool) = .init(false);

fn onSignal(_: std.posix.SIG) callconv(.c) void {
    signalled.store(true, .release);
}

pub fn Watchdog(comptime T: type) type {
    return struct {
        const Self = @This();

        io: Io,
        transmitter: *T,
        stopping_for: Io.Duration = .zero,

        pub fn watch(io: Io, transmitter: *T) noreturn {
            const action: std.posix.Sigaction = .{ .handler = .{ .handler = onSignal }, .mask = std.posix.sigemptyset(), .flags = 0 };
            std.posix.sigaction(.TERM, &action, null);
            std.posix.sigaction(.INT, &action, null);
            var self: Self = .{ .io = io, .transmitter = transmitter };
            while (true) {
                io.sleep(tick_interval, .awake) catch {};
                self.tick();
            }
        }

        fn tick(self: *Self) void {
            if (signalled.load(.acquire)) self.transmitter.quit();
            if (self.transmitter.closed()) std.process.exit(0);

            if (self.transmitter.busy()) |call| {
                const age = call.since.untilNow(self.io).raw;
                if (age.nanoseconds >= busy_limit.nanoseconds) self.die("the device call {s} has not returned for {d} s", .{ call.name, age.toSeconds() });
                return;
            }

            if (!self.transmitter.stopping()) {
                self.stopping_for = .zero;
                return;
            }
            self.stopping_for.nanoseconds += tick_interval.nanoseconds;
            if (self.stopping_for.nanoseconds >= stop_limit.nanoseconds) self.die("a stop has not finished for {d} s", .{self.stopping_for.toSeconds()});
        }

        fn die(self: *Self, comptime fmt: []const u8, args: anytype) noreturn {
            console.line(self.io, fmt ++ "; exiting with 3", args);
            if (builtin.link_libc) std.c._exit(3);
            std.process.exit(3);
        }
    };
}
