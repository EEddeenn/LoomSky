const std = @import("std");
const json = @import("json.zig");

pub const token_len = 64;

pub const Reference = enum { none, external, gpsdo };

pub const Station = struct {
    name: []const u8,
    device: [:0]const u8,
    channel: u32,
    reference: Reference,
    bands_hz: []const [2]f64,
    max_gain_db: f64,
};

pub const Host = struct {
    token: []const u8,
    origins: []const []const u8,
    station: Station,

    pub fn parse(arena: std.mem.Allocator, text: []const u8, why: *[]const u8) error{ Host, Token }!Host {
        const host = json.parse(Host, arena, text, why) catch return error.Host;
        if (host.token.len != token_len or !allHex(host.token)) {
            why.* = std.fmt.comptimePrint("token must be {d} hex digits", .{token_len});
            return error.Token;
        }
        if (std.mem.indexOfScalar(u8, host.station.device, 0) != null) {
            why.* = "device must not contain a null character";
            return error.Host;
        }
        for (host.station.bands_hz) |band| if (!(band[0] < band[1])) {
            why.* = "each band of bands_hz runs from its low edge to a higher one";
            return error.Host;
        };
        return host;
    }

    pub fn allowedOrigin(host: *const Host, origin: []const u8) ?[]const u8 {
        for (host.origins) |listed| if (std.mem.eql(u8, listed, origin)) return listed;
        return null;
    }

    pub fn admits(host: *const Host, token: []const u8) bool {
        if (token.len != token_len) return false;
        return std.crypto.timing_safe.eql([token_len]u8, token[0..token_len].*, host.token[0..token_len].*);
    }
};

fn allHex(text: []const u8) bool {
    for (text) |c| if (!std.ascii.isHex(c)) return false;
    return true;
}
