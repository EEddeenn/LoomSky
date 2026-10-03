const std = @import("std");
const core = @import("core");
const c = @import("uhd_h");
const device = core.device;
const GpsTime = core.time.GpsTime;
const Station = core.host.Station;
const Reference = core.host.Reference;

const mboard = 0;

pub const Uhd = struct {
    usrp: c.uhd_usrp_handle = null,
    tx: c.uhd_tx_streamer_handle = null,
    middle: c.uhd_tx_metadata_handle = null,
    end: c.uhd_tx_metadata_handle = null,
    events: c.uhd_async_metadata_handle = null,
    reference: Reference = .none,
    text: [512]u8 = undefined,
    text_len: usize = 0,

    const Source = enum { global, usrp, tx, events };

    pub fn open(self: *Uhd, station: *const Station) error{ Absent, Device }!void {
        self.reference = station.reference;
        const made = c.uhd_usrp_make(&self.usrp, station.device.ptr);
        if (made != c.UHD_ERROR_NONE) {
            self.note("uhd_usrp_make", .global);
            self.usrp = null;
            return if (made == c.UHD_ERROR_KEY) error.Absent else error.Device;
        }
        errdefer self.close();

        const source: [:0]const u8 = switch (station.reference) {
            .none => "internal",
            .external => "external",
            .gpsdo => "gpsdo",
        };
        if (!self.ok(c.uhd_usrp_set_clock_source(self.usrp, source.ptr, mboard), "uhd_usrp_set_clock_source", .usrp)) return error.Device;
        if (!self.ok(c.uhd_usrp_set_time_source(self.usrp, source.ptr, mboard), "uhd_usrp_set_time_source", .usrp)) return error.Device;

        if (!self.ok(c.uhd_tx_metadata_make(&self.middle, false, 0, 0, false, false), "uhd_tx_metadata_make", .global)) return error.Device;
        if (!self.ok(c.uhd_tx_metadata_make(&self.end, false, 0, 0, false, true), "uhd_tx_metadata_make", .global)) return error.Device;
        if (!self.ok(c.uhd_async_metadata_make(&self.events), "uhd_async_metadata_make", .global)) return error.Device;
    }

    pub fn close(self: *Uhd) void {
        if (self.tx != null) _ = c.uhd_tx_streamer_free(&self.tx);
        if (self.events != null) _ = c.uhd_async_metadata_free(&self.events);
        if (self.end != null) _ = c.uhd_tx_metadata_free(&self.end);
        if (self.middle != null) _ = c.uhd_tx_metadata_free(&self.middle);
        if (self.usrp != null) _ = c.uhd_usrp_free(&self.usrp);
        self.tx = null;
        self.events = null;
        self.end = null;
        self.middle = null;
        self.usrp = null;
    }

    pub fn tune(self: *Uhd, settings: device.Settings) error{Device}!device.Readback {
        const ch = settings.channel;
        var request: c.uhd_tune_request_t = .{
            .target_freq = settings.centre.hz,
            .rf_freq_policy = c.UHD_TUNE_REQUEST_POLICY_AUTO,
            .dsp_freq_policy = c.UHD_TUNE_REQUEST_POLICY_AUTO,
            .args = @constCast(""),
        };
        var result: c.uhd_tune_result_t = undefined;
        var rate: f64 = 0;
        var centre: f64 = 0;
        var gain: f64 = 0;
        if (!self.ok(c.uhd_usrp_set_tx_rate(self.usrp, settings.rate.hz, ch), "uhd_usrp_set_tx_rate", .usrp)) return error.Device;
        if (!self.ok(c.uhd_usrp_set_tx_freq(self.usrp, &request, ch, &result), "uhd_usrp_set_tx_freq", .usrp)) return error.Device;
        if (!self.ok(c.uhd_usrp_set_tx_gain(self.usrp, settings.gain.db, ch, ""), "uhd_usrp_set_tx_gain", .usrp)) return error.Device;

        if (!self.ok(c.uhd_usrp_get_tx_rate(self.usrp, ch, &rate), "uhd_usrp_get_tx_rate", .usrp)) return error.Device;
        if (!self.ok(c.uhd_usrp_get_tx_freq(self.usrp, ch, &centre), "uhd_usrp_get_tx_freq", .usrp)) return error.Device;
        if (!self.ok(c.uhd_usrp_get_tx_gain(self.usrp, ch, "", &gain), "uhd_usrp_get_tx_gain", .usrp)) return error.Device;

        var channel = ch;
        var args: c.uhd_stream_args_t = .{
            .cpu_format = @constCast("sc16"),
            .otw_format = @constCast("sc16"),
            .args = @constCast("underflow_policy=next_burst"),
            .channel_list = &channel,
            .n_channels = 1,
        };
        if (!self.ok(c.uhd_tx_streamer_make(&self.tx), "uhd_tx_streamer_make", .global)) return error.Device;
        if (!self.ok(c.uhd_usrp_get_tx_stream(self.usrp, &args, self.tx), "uhd_usrp_get_tx_stream", .usrp)) {
            self.untune();
            return error.Device;
        }
        return .{ .rate = .{ .hz = rate }, .centre = .{ .hz = centre }, .gain = .{ .db = gain } };
    }

    pub fn untune(self: *Uhd) void {
        if (self.tx != null) _ = c.uhd_tx_streamer_free(&self.tx);
        self.tx = null;
    }

    pub fn locked(self: *Uhd) error{Device}!device.Locks {
        return .{ .ref = try self.sensor("ref_locked"), .gps = self.reference == .gpsdo and try self.sensor("gps_locked") };
    }

    pub fn setTime(self: *Uhd, at: device.At) error{Clock}!void {
        const set = switch (at) {
            .now => |t| now: {
                const d = t.toDevice();
                break :now self.ok(c.uhd_usrp_set_time_now(self.usrp, d.full_s, d.frac_s, mboard), "uhd_usrp_set_time_now", .usrp);
            },
            .next_pps => |t| next: {
                const d = t.toDevice();
                break :next self.ok(c.uhd_usrp_set_time_next_pps(self.usrp, d.full_s, d.frac_s, mboard), "uhd_usrp_set_time_next_pps", .usrp);
            },
        };
        if (!set) return error.Clock;
    }

    pub fn now(self: *Uhd) error{Device}!GpsTime {
        var full: i64 = 0;
        var frac: f64 = 0;
        if (!self.ok(c.uhd_usrp_get_time_now(self.usrp, mboard, &full, &frac), "uhd_usrp_get_time_now", .usrp)) return error.Device;
        return self.time("uhd_usrp_get_time_now", full, frac);
    }

    pub fn lastPps(self: *Uhd) error{Device}!GpsTime {
        var full: i64 = 0;
        var frac: f64 = 0;
        if (!self.ok(c.uhd_usrp_get_time_last_pps(self.usrp, mboard, &full, &frac), "uhd_usrp_get_time_last_pps", .usrp)) return error.Device;
        return self.time("uhd_usrp_get_time_last_pps", full, frac);
    }

    pub fn send(self: *Uhd, bytes: []const u8, burst: device.Burst, timeout: std.Io.Duration) error{Send}!usize {
        var timed: c.uhd_tx_metadata_handle = null;
        defer if (timed != null) {
            _ = c.uhd_tx_metadata_free(&timed);
        };
        const metadata: *c.uhd_tx_metadata_handle = switch (burst) {
            .start => |t| start: {
                const d = t.toDevice();
                if (!self.ok(c.uhd_tx_metadata_make(&timed, true, d.full_s, d.frac_s, true, false), "uhd_tx_metadata_make", .global)) return error.Send;
                break :start &timed;
            },
            .middle => &self.middle,
            .end => &self.end,
        };
        var buffer: ?*const anyopaque = bytes.ptr;
        var sent: usize = 0;
        const seconds = @as(f64, @floatFromInt(timeout.nanoseconds)) / std.time.ns_per_s;
        if (!self.ok(c.uhd_tx_streamer_send(self.tx, &buffer, bytes.len / 4, metadata, seconds, &sent), "uhd_tx_streamer_send", .tx)) return error.Send;
        return sent * 4;
    }

    pub fn event(self: *Uhd) error{Device}!?device.Event {
        while (true) {
            var valid = false;
            if (!self.ok(c.uhd_tx_streamer_recv_async_msg(self.tx, &self.events, 0.0, &valid), "uhd_tx_streamer_recv_async_msg", .tx)) return error.Device;
            if (!valid) return null;
            var code: c.uhd_async_metadata_event_code_t = 0;
            if (!self.ok(c.uhd_async_metadata_event_code(self.events, &code), "uhd_async_metadata_event_code", .events)) return error.Device;
            return switch (code) {
                c.UHD_ASYNC_METADATA_EVENT_CODE_BURST_ACK => .ack,
                c.UHD_ASYNC_METADATA_EVENT_CODE_UNDERFLOW, c.UHD_ASYNC_METADATA_EVENT_CODE_UNDERFLOW_IN_PACKET => .underflow,
                c.UHD_ASYNC_METADATA_EVENT_CODE_TIME_ERROR => .late,
                c.UHD_ASYNC_METADATA_EVENT_CODE_SEQ_ERROR, c.UHD_ASYNC_METADATA_EVENT_CODE_SEQ_ERROR_IN_BURST => .sequence,
                else => continue,
            };
        }
    }

    pub fn failure(self: *const Uhd) []const u8 {
        return self.text[0..self.text_len];
    }

    fn sensor(self: *Uhd, name: [:0]const u8) error{Device}!bool {
        var value: c.uhd_sensor_value_handle = null;
        if (!self.ok(c.uhd_sensor_value_make(&value), "uhd_sensor_value_make", .global)) return error.Device;
        defer _ = c.uhd_sensor_value_free(&value);
        var on = false;
        if (!self.ok(c.uhd_usrp_get_mboard_sensor(self.usrp, name.ptr, mboard, &value), "uhd_usrp_get_mboard_sensor", .usrp)) return error.Device;
        if (!self.ok(c.uhd_sensor_value_to_bool(value, &on), "uhd_sensor_value_to_bool", .global)) return error.Device;
        return on;
    }

    fn time(self: *Uhd, call: []const u8, full: i64, frac: f64) error{Device}!GpsTime {
        return GpsTime.ofDevice(full, frac) catch {
            self.keep(std.fmt.bufPrint(&self.text, "{s}: the radio reads {d} s and {d}, outside GPS time", .{ call, full, frac }) catch call);
            return error.Device;
        };
    }

    fn ok(self: *Uhd, result: c.uhd_error, call: []const u8, source: Source) bool {
        if (result == c.UHD_ERROR_NONE) return true;
        self.note(call, source);
        return false;
    }

    fn note(self: *Uhd, call: []const u8, source: Source) void {
        var reason: [448]u8 = @splat(0);
        _ = switch (source) {
            .global => c.uhd_get_last_error(&reason, reason.len),
            .usrp => c.uhd_usrp_last_error(self.usrp, &reason, reason.len),
            .tx => c.uhd_tx_streamer_last_error(self.tx, &reason, reason.len),
            .events => c.uhd_async_metadata_last_error(self.events, &reason, reason.len),
        };
        self.keep(std.fmt.bufPrint(&self.text, "{s}: {s}", .{ call, std.mem.sliceTo(&reason, 0) }) catch call);
    }

    fn keep(self: *Uhd, message: []const u8) void {
        if (message.ptr != @as([*]const u8, &self.text)) @memcpy(self.text[0..message.len], message);
        self.text_len = message.len;
    }
};
