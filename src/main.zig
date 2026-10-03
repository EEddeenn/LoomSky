const std = @import("std");
const Io = std.Io;
const core = @import("core");
const transmit = @import("transmit");
const serve = @import("serve");
const Uhd = @import("uhd").Uhd;

const Transmitter = transmit.Transmitter(Uhd);
const console = core.console;

pub fn main(init: std.process.Init) u8 {
    const io = init.io;
    const arena = init.arena.allocator();
    const args = init.minimal.args.toSlice(arena) catch {
        console.line(io, "out of memory", .{});
        return 1;
    };
    if (args.len != 3) return fail(io, "usage: loomsky <address:port> <host.json>", .{});
    const address = Io.net.IpAddress.parseLiteral(args[1]) catch return fail(io, "{s} is no address:port", .{args[1]});

    const text = Io.Dir.cwd().readFileAlloc(io, args[2], arena, .limited(1 << 20)) catch |e| return fail(io, "cannot read {s}: {s}", .{ args[2], @errorName(e) });
    var why: []const u8 = "";
    const host = core.host.Host.parse(arena, text, &why) catch |e| switch (e) {
        error.Host => return fail(io, "{s}: {s}", .{ args[2], why }),
        error.Token => {
            var fresh: [core.host.token_len / 2]u8 = undefined;
            io.randomSecure(&fresh) catch return fail(io, "{s}: {s}; the system has no entropy for a fresh one", .{ args[2], why });
            return fail(io, "{s}: {s}; a fresh one: {x}", .{ args[2], why, &fresh });
        },
    };

    var listener = serve.Server(Transmitter).listen(io, address) catch |e| {
        console.line(io, "cannot serve on {s}: {s}", .{ args[1], @errorName(e) });
        return 1;
    };

    var bits: [8]u8 = undefined;
    io.random(&bits);
    const boot = std.mem.readInt(u64, &bits, .little);
    var radio: Uhd = .{};
    var transmitter: Transmitter = .init(io, init.gpa, &host, boot, &radio);

    const driver = std.Thread.spawn(.{}, Transmitter.drive, .{&transmitter}) catch |e| {
        console.line(io, "cannot start the radio thread: {s}", .{@errorName(e)});
        return 1;
    };
    driver.detach();

    const watchdog = std.Thread.spawn(.{}, serve.Watchdog(Transmitter).watch, .{ io, &transmitter }) catch |e| {
        console.line(io, "cannot start the watchdog: {s}", .{@errorName(e)});
        std.c._exit(1);
    };

    console.line(io, "{s} on {s}, boot {x:0>16}", .{ host.station.name, args[1], boot });
    serve.Server(Transmitter).serve(io, init.gpa, &listener, &host, &transmitter);
    transmitter.quit();
    watchdog.join();
    unreachable;
}

fn fail(io: Io, comptime fmt: []const u8, args: anytype) u8 {
    console.line(io, fmt, args);
    return 2;
}
