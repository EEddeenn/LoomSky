const std = @import("std");
const Duration = std.Io.Duration;

pub const ns_per_ms: i64 = std.time.ns_per_ms;
pub const ns_per_s: i64 = std.time.ns_per_s;
pub const epoch_ns: i64 = ns_per_ms;

pub fn span(epochs: u64) Duration {
    return .fromNanoseconds(@as(i96, epochs) * epoch_ns);
}

pub const Leap = struct {
    seconds: i32,
    change: ?GpsTime,
    seconds_after: i32,
};

pub const GpsTime = struct {
    ns: i64,

    pub const limit: i64 = 1 << 62;
    const unix_to_gps: Duration = .fromSeconds(315_964_800);

    const Device = struct { full_s: i64, frac_s: f64 };

    pub fn ofMs(ms: i64, sub_ms: f64) error{Range}!GpsTime {
        if (ms < 0 or ms >= @divFloor(limit, ns_per_ms) or !(sub_ms >= 0 and sub_ms < 1)) return error.Range;
        return .{ .ns = ms * ns_per_ms + @as(i64, @intFromFloat(@round(sub_ms * ns_per_ms))) };
    }

    pub fn ofDevice(full_s: i64, frac_s: f64) error{Range}!GpsTime {
        if (full_s < 0 or full_s >= @divFloor(limit, ns_per_s) or !(frac_s >= 0 and frac_s < 1)) return error.Range;
        return .{ .ns = full_s * ns_per_s + @as(i64, @intFromFloat(@round(frac_s * ns_per_s))) };
    }

    pub fn toDevice(t: GpsTime) Device {
        const full = @divFloor(t.ns, ns_per_s);
        return .{ .full_s = full, .frac_s = @as(f64, @floatFromInt(t.ns - full * ns_per_s)) / ns_per_s };
    }

    fn ofUnix(unix_ns: i96, leap: Leap) GpsTime {
        const since: i64 = @intCast(unix_ns - unix_to_gps.nanoseconds);
        const seconds = if (leap.change) |change|
            if (since >= change.ns - @as(i64, leap.seconds_after) * ns_per_s) leap.seconds_after else leap.seconds
        else
            leap.seconds;
        return .{ .ns = since + @as(i64, seconds) * ns_per_s };
    }

    pub fn host(io: std.Io, leap: Leap) GpsTime {
        return ofUnix(std.Io.Clock.real.now(io).nanoseconds, leap);
    }

    pub fn add(t: GpsTime, d: Duration) GpsTime {
        return .{ .ns = t.ns + @as(i64, @intCast(d.nanoseconds)) };
    }

    pub fn sub(t: GpsTime, d: Duration) GpsTime {
        return .{ .ns = t.ns - @as(i64, @intCast(d.nanoseconds)) };
    }

    pub fn order(a: GpsTime, b: GpsTime) std.math.Order {
        return std.math.order(a.ns, b.ns);
    }
};

pub const Epoch = enum(u64) {
    _,

    pub fn of(n: u64) Epoch {
        return @enumFromInt(n);
    }

    pub fn index(e: Epoch) u64 {
        return @intFromEnum(e);
    }

    pub fn plus(e: Epoch, n: u64) Epoch {
        return @enumFromInt(@intFromEnum(e) + n);
    }
};

pub const Window = struct {
    start: GpsTime,
    epochs: u64,

    pub fn air(w: Window, e: Epoch) GpsTime {
        return w.start.add(span(e.index()));
    }

    pub fn entry(w: Window, t: GpsTime, lead: Duration) ?Epoch {
        const ahead = t.add(lead).ns - w.start.ns;
        const e: u64 = if (ahead <= 0) 0 else @intCast(@divFloor(ahead - 1, epoch_ns) + 1);
        return if (e < w.epochs) .of(e) else null;
    }
};
