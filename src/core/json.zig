const std = @import("std");

pub fn parse(comptime T: type, arena: std.mem.Allocator, text: []const u8, why: *[]const u8) error{Invalid}!T {
    var scanner = std.json.Scanner.initCompleteInput(arena, text);
    var diagnostics: std.json.Diagnostics = .{};
    scanner.enableDiagnostics(&diagnostics);
    const value = std.json.parseFromTokenSourceLeaky(std.json.Value, arena, &scanner, .{ .parse_numbers = false }) catch |e| {
        why.* = std.fmt.allocPrint(arena, "{s} at {d}:{d}", .{ @errorName(e), diagnostics.getLine(), diagnostics.getColumn() }) catch "out of memory";
        return error.Invalid;
    };
    const result = convert(T, arena, value, .{}) catch |e| {
        why.* = @errorName(e);
        return error.Invalid;
    };
    if (!finite(result)) {
        why.* = "a number is not finite";
        return error.Invalid;
    }
    return result;
}

pub fn convert(comptime T: type, arena: std.mem.Allocator, value: std.json.Value, options: std.json.ParseOptions) std.json.ParseFromValueError!T {
    try shape(T, value);
    return std.json.parseFromValueLeaky(T, arena, value, options);
}

fn shape(comptime T: type, value: std.json.Value) error{ UnexpectedToken, InvalidEnumTag }!void {
    if (comptime std.meta.hasFn(T, "jsonParseFromValue")) return;
    switch (@typeInfo(T)) {
        .int, .float => switch (value) {
            .integer, .float, .number_string => {},
            else => return error.UnexpectedToken,
        },
        .@"enum" => {
            if (value != .string) return error.UnexpectedToken;
            if (std.meta.stringToEnum(T, value.string) == null) return error.InvalidEnumTag;
        },
        .optional => |o| if (value != .null) try shape(o.child, value),
        .@"struct" => |s| {
            if (value != .object) return error.UnexpectedToken;
            inline for (s.fields) |field| {
                if (value.object.get(field.name)) |item| try shape(field.type, item);
            }
        },
        .@"union" => |u| {
            if (value != .object) return error.UnexpectedToken;
            inline for (u.fields) |field| {
                if (value.object.get(field.name)) |item| try shape(field.type, item);
            }
        },
        .array => |a| {
            if (value != .array) return error.UnexpectedToken;
            for (value.array.items) |item| try shape(a.child, item);
        },
        .pointer => |p| switch (p.size) {
            .one => try shape(p.child, value),
            .slice => if (p.child == u8) {
                if (value != .string) return error.UnexpectedToken;
            } else {
                if (value != .array) return error.UnexpectedToken;
                for (value.array.items) |item| try shape(p.child, item);
            },
            .many, .c => @compileError("JSON values cannot contain unbounded pointers"),
        },
        else => {},
    }
}

fn finite(value: anytype) bool {
    return switch (@typeInfo(@TypeOf(value))) {
        .float => std.math.isFinite(value),
        .optional => if (value) |v| finite(v) else true,
        .@"struct" => |s| inline for (s.fields) |f| {
            if (!finite(@field(value, f.name))) break false;
        } else true,
        .@"union" => switch (value) {
            inline else => |v| finite(v),
        },
        .array => for (value) |v| {
            if (!finite(v)) break false;
        } else true,
        .pointer => |p| if (p.size != .slice or p.child == u8) true else for (value) |v| {
            if (!finite(v)) break false;
        } else true,
        else => true,
    };
}
