const std = @import("std");
const Io = std.Io;
const core = @import("core");
const Info = @import("pharos_run").engine.run.Info;
const ring = @import("ring.zig");
const GpsTime = core.time.GpsTime;
const Window = core.time.Window;
const Leap = core.time.Leap;
const Station = core.host.Station;
const Config = core.config.Config;
const Settings = core.device.Settings;
const Readback = core.device.Readback;
const Db = core.device.Db;
const bufPrint = std.fmt.bufPrint;

const Clock = union(enum) { live, replay: GpsTime };

pub const Plan = struct {
    settings: Settings,
    max_gain: Db,
    window: Window,
    clock: Clock,
    leap: Leap,
    bytes_per_epoch: usize,

    pub fn resolve(io: Io, station: *const Station, config: Config, info: *const Info, buffer: []u8, why: *[]const u8) error{ Format, Band, Gain, Window }!Plan {
        const format_bits = info.samples.format.bitsPerComponent();
        if (format_bits != 16) {
            why.* = bufPrint(buffer, "the bundle's samples are IQ{d}; the radio takes IQ16", .{format_bits}) catch "the radio takes IQ16";
            return error.Format;
        }

        const rate: f64 = @floatFromInt(info.samples.sample_rate.hz());
        const centre: f64 = @floatFromInt(info.samples.center.hz);
        const low = centre - rate / 2;
        const high = centre + rate / 2;
        for (station.bands_hz) |band| {
            if (band[0] <= low and high <= band[1]) break;
        } else {
            why.* = bufPrint(buffer, "{d:.6} to {d:.6} MHz lies in no band of bands_hz in the host file", .{ low / 1e6, high / 1e6 }) catch "the signal lies in no band of the host file";
            return error.Band;
        }

        if (!(config.gain_db <= station.max_gain_db)) {
            why.* = bufPrint(buffer, "gain_db {d} is above max_gain_db {d} in the host file", .{ config.gain_db, station.max_gain_db }) catch "gain_db is above max_gain_db in the host file";
            return error.Gain;
        }

        const window = bounded(info) orelse {
            why.* = bufPrint(buffer, "the window of {d} ms from {d} ms lies beyond GPS time's range", .{ info.span.epochs, info.span.start.ms }) catch "the window lies beyond GPS time's range";
            return error.Window;
        };

        const leap: Leap = .{
            .seconds = info.span.leap_seconds,
            .change = if (info.span.leap_change) |change| GpsTime.ofMs(change.ms, change.sub_ms) catch {
                why.* = bufPrint(buffer, "the leap second change at {d} ms lies beyond GPS time's range", .{change.ms}) catch "the leap second change lies beyond GPS time's range";
                return error.Window;
            } else null,
            .seconds_after = info.span.leap_seconds_after,
        };

        const clock: Clock = if (config.replay_ms) |ms| clock: {
            if (ms >= window.epochs) {
                why.* = bufPrint(buffer, "replay_ms {d} lies beyond the window's {d} ms", .{ ms, window.epochs }) catch "replay_ms lies beyond the window";
                return error.Window;
            }
            break :clock .{ .replay = window.start.add(core.time.span(ms)) };
        } else .live;
        const first = switch (clock) {
            .live => GpsTime.host(io, leap),
            .replay => |t| t,
        };
        if (window.entry(first, ring.lead) == null) {
            why.* = bufPrint(buffer, "no epoch of the window's {d} ms airs a lead after {s}", .{ window.epochs, if (clock == .live) "now" else "replay_ms" }) catch "no epoch of the window airs a lead later";
            return error.Window;
        }

        return .{
            .settings = .{
                .channel = station.channel,
                .rate = .{ .hz = rate },
                .centre = .{ .hz = centre },
                .gain = .{ .db = config.gain_db },
            },
            .max_gain = .{ .db = station.max_gain_db },
            .window = window,
            .clock = clock,
            .leap = leap,
            .bytes_per_epoch = info.bytes_per_epoch,
        };
    }

    fn bounded(info: *const Info) ?Window {
        const start = GpsTime.ofMs(info.span.start.ms, info.span.start.sub_ms) catch return null;
        if (info.span.epochs >= @divFloor(GpsTime.limit - start.ns, core.time.epoch_ns)) return null;
        return .{ .start = start, .epochs = info.span.epochs };
    }

    pub fn check(plan: Plan, readback: Readback, buffer: []u8, why: *[]const u8) error{Readback}!void {
        const settings = plan.settings;
        if (readback.rate.hz == settings.rate.hz and
            @abs(readback.centre.hz - settings.centre.hz) <= 1 and
            std.math.isFinite(readback.gain.db) and
            readback.gain.db <= plan.max_gain.db) return;
        why.* = bufPrint(buffer, "the radio reads back {d} Hz, {d} Hz and {d} dB for {d} Hz, {d} Hz and {d} dB, at most {d} dB", .{
            readback.rate.hz, readback.centre.hz, readback.gain.db, settings.rate.hz, settings.centre.hz, settings.gain.db, plan.max_gain.db,
        }) catch "the radio reads back other settings";
        return error.Readback;
    }
};
