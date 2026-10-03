const std = @import("std");
const json = @import("json.zig");
const OperationId = @import("identity.zig").OperationId;

pub const label_limit = 256;

pub const Config = struct {
    gain_db: f64,
    replay_ms: ?u64 = null,
    label: ?[]const u8 = null,
};

pub const Submission = struct {
    operation: OperationId,
    config: Config,

    pub fn parse(arena: std.mem.Allocator, text: []const u8, why: *[]const u8) error{Config}!Submission {
        const submission = json.parse(Submission, arena, text, why) catch return error.Config;
        if (submission.config.label) |label| if (label.len > label_limit) {
            why.* = std.fmt.comptimePrint("label exceeds {d} bytes", .{label_limit});
            return error.Config;
        };
        return submission;
    }
};
