const std = @import("std");
const Io = std.Io;
const GpsTime = @import("time.zig").GpsTime;
const Station = @import("host.zig").Station;

pub const Hz = struct { hz: f64 };
pub const Db = struct { db: f64 };

pub const Settings = struct { channel: usize, rate: Hz, centre: Hz, gain: Db };
pub const Readback = struct { rate: Hz, centre: Hz, gain: Db };
pub const Locks = struct { ref: bool, gps: bool };
pub const At = union(enum) { now: GpsTime, next_pps: GpsTime };
pub const Burst = union(enum) { start: GpsTime, middle, end };
pub const Event = enum { ack, underflow, late, sequence };

pub const Operation = enum(u4) { open, close, tune, untune, locked, set_time, now, last_pps, send, event };

pub const Call = struct { name: []const u8, since: Io.Clock.Timestamp };

pub fn method(op: Operation) []const u8 {
    return switch (op) {
        .open => "open",
        .close => "close",
        .tune => "tune",
        .untune => "untune",
        .locked => "locked",
        .set_time => "setTime",
        .now => "now",
        .last_pps => "lastPps",
        .send => "send",
        .event => "event",
    };
}

pub fn Signature(comptime D: type, comptime op: Operation) type {
    return switch (op) {
        .open => fn (*D, *const Station) error{ Absent, Device }!void,
        .close => fn (*D) void,
        .tune => fn (*D, Settings) error{Device}!Readback,
        .untune => fn (*D) void,
        .locked => fn (*D) error{Device}!Locks,
        .set_time => fn (*D, At) error{Clock}!void,
        .now => fn (*D) error{Device}!GpsTime,
        .last_pps => fn (*D) error{Device}!GpsTime,
        .send => fn (*D, []const u8, Burst, Io.Duration) error{Send}!usize,
        .event => fn (*D) error{Device}!?Event,
    };
}

pub fn check(comptime D: type) void {
    inline for (comptime std.enums.values(Operation)) |op| expect(D, method(op), Signature(D, op));
    expect(D, "failure", fn (*const D) []const u8);
}

fn expect(comptime D: type, comptime name: []const u8, comptime F: type) void {
    if (!@hasDecl(D, name)) @compileError(@typeName(D) ++ " has no " ++ name);
    const Found = @TypeOf(@field(D, name));
    if (Found != F) @compileError(@typeName(D) ++ "." ++ name ++ " is " ++ @typeName(Found) ++ ", not " ++ @typeName(F));
}
