const std = @import("std");

pub fn line(io: std.Io, comptime fmt: []const u8, args: anytype) void {
    var buffer: [512]u8 = undefined;
    var stderr: std.Io.File.Writer = .initStreaming(.stderr(), io, &buffer);
    stderr.interface.print("loomsky: " ++ fmt ++ "\n", args) catch return;
    stderr.interface.flush() catch return;
}
