const std = @import("std");
const Io = std.Io;
const core = @import("core");
const Radio = @import("radio.zig").Radio;
const Job = @import("control.zig").Job;
const Producer = @import("producer.zig").Producer;
const stream = @import("stream.zig");
const status = core.status;

pub fn Transmitter(comptime Device: type) type {
    return struct {
        const Self = @This();

        radio: Radio(Device),

        pub fn init(io: Io, gpa: std.mem.Allocator, host: *const core.host.Host, boot: u64, dev: *Device) Self {
            return .{ .radio = .init(io, gpa, host, boot, dev) };
        }

        pub fn reserve(self: *Self, operation: core.identity.OperationId) error{ Busy, Other, Closing }!void {
            const control = &self.radio.control;
            control.lock();
            defer control.unlock();
            try control.reserve(operation);
        }

        pub fn release(self: *Self, operation: core.identity.OperationId) void {
            const control = &self.radio.control;
            control.lock();
            defer control.unlock();
            control.releaseUpload(operation);
        }

        pub fn submit(self: *Self, operation: core.identity.OperationId, bundle: []u8, config: core.config.Config) error{ Other, Closing }!core.identity.RunId {
            const control = &self.radio.control;
            control.lock();
            defer control.unlock();
            return control.commit(operation, bundle, config);
        }

        pub fn command(self: *Self, request: core.command.Request, w: *Io.Writer) (error{ Other, Closed, ActionConflict, OutOfMemory } || Io.Writer.Error)!void {
            const control = &self.radio.control;
            control.lock();
            defer control.unlock();
            const receipt = try control.record(request);
            try receipt.writeReceipt(request.target, w);
        }

        pub fn stop(self: *Self, target: core.identity.RunId) error{Other}!void {
            const control = &self.radio.control;
            control.lock();
            defer control.unlock();
            try control.stopRun(target);
        }

        pub fn cancel(self: *Self, operation: core.identity.OperationId) error{ Busy, Other }!void {
            const control = &self.radio.control;
            control.lock();
            defer control.unlock();
            try control.cancel(operation);
        }

        pub fn quit(self: *Self) void {
            const control = &self.radio.control;
            control.lock();
            defer control.unlock();
            control.quit = true;
            control.requestStop();
        }

        pub fn snapshot(self: *Self, w: *Io.Writer) Io.Writer.Error!void {
            const control = &self.radio.control;
            control.lock();
            defer control.unlock();
            try (status.Snapshot{
                .boot = control.boot,
                .run = control.run,
                .operation = control.operation,
                .device = control.device,
                .station = &self.radio.host.station,
                .now_ms = Io.Clock.real.now(control.io).toMilliseconds(),
                .status = if (control.status) |*s| s else null,
            }).write(w);
        }

        pub fn busy(self: *Self) ?core.device.Call {
            return self.radio.busy();
        }

        pub fn stopping(self: *Self) bool {
            const control = &self.radio.control;
            control.lock();
            defer control.unlock();
            return (control.live and control.stop) or (control.quit and !control.closed);
        }

        pub fn closed(self: *Self) bool {
            const control = &self.radio.control;
            control.lock();
            defer control.unlock();
            return control.closed;
        }

        pub fn drive(self: *Self) void {
            _ = self.radio.openDevice();
            while (self.next()) |job| self.transmit(job);
            if (self.radio.open) self.radio.call(.close, .{});
            const control = &self.radio.control;
            control.lock();
            defer control.unlock();
            control.closed = true;
            control.wake();
        }

        fn next(self: *Self) ?Job {
            const control = &self.radio.control;
            control.lock();
            defer control.unlock();
            while (control.job == null and !control.quit) control.wait();
            const job = control.job orelse return null;
            control.job = null;
            return job;
        }

        fn transmit(self: *Self, job: Job) void {
            const control = &self.radio.control;
            var producer: Producer = .{ .control = control, .station = &self.radio.host.station, .job = job };
            control.lock();
            control.producing = true;
            control.unlock();

            var outcome: status.Outcome = undefined;
            if (std.Thread.spawn(.{}, Producer.main, .{&producer})) |thread| {
                outcome = stream.air(&self.radio);

                control.lock();
                control.producing = false;
                control.closeCommands();
                control.wake();
                control.unlock();
                thread.join();
            } else |_| {
                control.gpa.free(job.bundle);
                outcome = self.radio.failed(.host, "the producer thread could not start");
            }

            control.lock();
            defer control.unlock();
            if (control.handoff == .ready) {
                control.handoff.ready.ring.deinit(control.gpa);
                control.handoff = .pending;
            }
            control.finish(outcome);
        }
    };
}
