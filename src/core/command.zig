const std = @import("std");
const json = @import("json.zig");
const identity = @import("identity.zig");

const System = @import("pharos_run").core.types.System;

const Level = union(enum) {
    dbhz: f64,
    dbm: f64,
    dbw: f64,
    scenario,
};

const Power = struct {
    system: System,
    svid: u32,
    level: Level,

    const Unit = enum { dbhz, dbm, dbw };

    pub fn jsonParseFromValue(arena: std.mem.Allocator, value: std.json.Value, options: std.json.ParseOptions) std.json.ParseFromValueError!Power {
        if (value != .object) return error.UnexpectedToken;
        var system: ?System = null;
        var svid: ?u32 = null;
        var level: Level = .scenario;
        var fields = value.object.iterator();
        while (fields.next()) |field| {
            const key = field.key_ptr.*;
            const item = field.value_ptr.*;
            if (std.mem.eql(u8, key, "system")) {
                if (item != .string) return error.UnexpectedToken;
                system = for (System.all) |s| {
                    if (std.mem.eql(u8, s.name(), item.string)) break s;
                } else return error.InvalidEnumTag;
            } else if (std.mem.eql(u8, key, "svid")) {
                svid = try json.convert(u32, arena, item, options);
            } else {
                const unit = std.meta.stringToEnum(Unit, key) orelse return error.UnknownField;
                if (level != .scenario) return error.DuplicateField;
                const number = try json.convert(f64, arena, item, options);
                level = switch (unit) {
                    inline else => |u| @unionInit(Level, @tagName(u), number),
                };
            }
        }
        return .{
            .system = system orelse return error.MissingField,
            .svid = svid orelse return error.MissingField,
            .level = level,
        };
    }

    pub fn jsonStringify(self: Power, jw: anytype) !void {
        try jw.beginObject();
        try jw.objectField("system");
        try jw.write(self.system.name());
        try jw.objectField("svid");
        try jw.write(self.svid);
        switch (self.level) {
            .scenario => {},
            inline else => |value, unit| {
                try jw.objectField(@tagName(unit));
                try jw.write(value);
            },
        }
        try jw.endObject();
    }
};

pub const Command = union(enum) {
    noise_floor_dbm_hz: f64,
    elevation_mask_deg: f64,
    power: Power,
};

pub const Stop = struct {
    target: identity.RunId,

    pub fn parse(arena: std.mem.Allocator, text: []const u8, why: *[]const u8) error{Stop}!Stop {
        return json.parse(Stop, arena, text, why) catch error.Stop;
    }
};

pub const Request = struct {
    target: identity.RunId,
    actionId: []const u8,
    command: Command,

    pub fn parse(arena: std.mem.Allocator, text: []const u8, why: *[]const u8) error{Command}!Request {
        const request = json.parse(Request, arena, text, why) catch return error.Command;
        if (request.actionId.len == 0 or request.actionId.len > 128) {
            why.* = "actionId must contain between 1 and 128 bytes";
            return error.Command;
        }
        return request;
    }
};

pub const Cancel = struct {
    operation: identity.OperationId,

    pub fn parse(arena: std.mem.Allocator, text: []const u8, why: *[]const u8) error{Cancel}!Cancel {
        return json.parse(Cancel, arena, text, why) catch error.Cancel;
    }
};
