const std = @import("std");

pub const Boot = struct {
    bits: u64,

    pub fn jsonParseFromValue(_: std.mem.Allocator, value: std.json.Value, _: std.json.ParseOptions) std.json.ParseFromValueError!Boot {
        return .{ .bits = try parseHex(u64, value) };
    }

    pub fn jsonStringify(self: Boot, jw: anytype) !void {
        try jw.print("\"{x:0>16}\"", .{self.bits});
    }
};

const Nonce = struct {
    bits: u128,

    pub fn jsonParseFromValue(_: std.mem.Allocator, value: std.json.Value, _: std.json.ParseOptions) std.json.ParseFromValueError!Nonce {
        return .{ .bits = try parseHex(u128, value) };
    }

    pub fn jsonStringify(self: Nonce, jw: anytype) !void {
        try jw.print("\"{x:0>32}\"", .{self.bits});
    }
};

pub const RunId = struct {
    boot: Boot,
    sequence: u64,
};

pub const OperationId = struct {
    boot: Boot,
    sequence: u64,
    nonce: Nonce,

    pub fn eql(self: OperationId, other: OperationId) bool {
        return self.boot.bits == other.boot.bits and self.sequence == other.sequence and self.nonce.bits == other.nonce.bits;
    }
};

fn parseHex(comptime T: type, value: std.json.Value) std.json.ParseFromValueError!T {
    const text = switch (value) {
        .string => |text| text,
        else => return error.UnexpectedToken,
    };
    if (text.len != @bitSizeOf(T) / 4) return error.InvalidCharacter;
    for (text) |c| if (!std.ascii.isDigit(c) and !(c >= 'a' and c <= 'f')) return error.InvalidCharacter;
    return std.fmt.parseInt(T, text, 16) catch error.InvalidCharacter;
}
