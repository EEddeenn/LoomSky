const std = @import("std");
const core = @import("core");
const pharos = @import("pharos_run");
const Control = @import("control.zig").Control;
const Job = @import("control.zig").Job;
const ring = @import("ring.zig");
const Plan = @import("plan.zig").Plan;
const status = core.status;
const Epoch = core.time.Epoch;
const Command = core.command.Command;
const Run = pharos.engine.run.Run;

const chunk_epochs = 10_000;
const batch_limit = pharos.engine.commands.capacity;

pub const Producer = struct {
    control: *Control,
    station: *const core.host.Station,
    job: Job,
    bundle: pharos.bundle.Bundle = undefined,
    run: *Run = undefined,
    error_buffer: [256]u8 = undefined,
    channels: status.Channels = .{},

    pub fn main(p: *Producer) void {
        var arena: std.heap.ArenaAllocator = .init(p.control.gpa);
        defer arena.deinit();
        p.run = p.create(arena.allocator()) orelse return;
        defer p.run.destroy();
        if (p.prepare()) p.produce();
    }

    fn create(p: *Producer, arena: std.mem.Allocator) ?*Run {
        const control = p.control;
        p.bundle = decoded: {
            defer control.gpa.free(p.job.bundle);
            var diags: pharos.core.diagnostics.Diagnostics = .init(arena);
            break :decoded pharos.bundle.format.read(arena, p.job.bundle, diags.forSource("")) catch |e| {
                const message = switch (e) {
                    error.OutOfMemory => "out of memory",
                    error.InvalidInput => p.formatError("cannot read the bundle: {f}", .{diags.firstError().?}),
                };
                control.lock();
                defer control.unlock();
                control.offer(if (e == error.OutOfMemory)
                    .{ .failed = .{ .reason = .host, .message = message } }
                else
                    .{ .refused = .{ .reason = .bundle, .message = message } });
                return null;
            };
        };
        const samples = p.bundle.scenario.samples orelse {
            control.lock();
            defer control.unlock();
            control.offer(.{ .refused = .{ .reason = .bundle, .message = "the bundle has no samples block: nothing to generate" } });
            return null;
        };
        return Run.create(control.gpa, &p.bundle, samples, .{ .gain = .{ .db = 0 } }) catch |e| {
            const message = p.formatError("cannot create the run: {f}", .{pharos.engine.run.createFailure(e)});
            control.lock();
            defer control.unlock();
            control.offer(switch (e) {
                error.MessageSet, error.MissingEarthOrientation, error.MissingTimeOffset, error.MissingUtcParameters => .{ .refused = .{ .reason = .bundle, .message = message } },
                error.OutOfMemory => .{ .failed = .{ .reason = .host, .message = message } },
                error.ThreadSpawnFailed, error.Internal => .{ .failed = .{ .reason = .generator, .message = message } },
            });
            return null;
        };
    }

    fn prepare(p: *Producer) bool {
        const control = p.control;
        p.drain();
        var buffer: [256]u8 = undefined;
        var why: []const u8 = "";
        const plan = Plan.resolve(control.io, p.station, p.job.config, &p.run.info, &buffer, &why) catch |e| {
            control.lock();
            defer control.unlock();
            const reason: status.Reason = switch (e) {
                error.Format => .format,
                error.Band => .band,
                error.Gain => .gain,
                error.Window => .window,
            };
            control.offer(.{ .refused = .{ .message = why, .reason = reason } });
            return false;
        };
        const slots = ring.Ring.init(control.gpa, plan.bytes_per_epoch) catch {
            control.lock();
            defer control.unlock();
            control.offer(.{ .failed = .{ .reason = .host, .message = "out of memory for the ring" } });
            return false;
        };
        control.lock();
        defer control.unlock();
        control.offer(.{ .ready = .{ .plan = plan, .ring = slots } });
        return true;
    }

    fn produce(p: *Producer) void {
        const control = p.control;
        control.lock();
        defer control.unlock();
        const slots = &control.handoff.ready.ring;

        var generation: u32 = 0;
        var ended = false;
        while (control.producing) {
            if (slots.generation != generation) {
                generation = slots.generation;
                const target = slots.target;

                control.unlock();
                const failure = p.enter(target, generation);
                control.lock();

                if (failure) |f| return control.fail(f.reason, f.message);
                ended = false;
                continue;
            }

            if (generation == 0 or ended) {
                control.wait();
                continue;
            }

            const slot = slots.claim() orelse {
                control.wait();
                continue;
            };

            var indices: [batch_limit]usize = undefined;
            var commands: [batch_limit]Command = undefined;
            const count = @min(batch_limit, control.records.items.len - control.next_command_index);
            for (0..count) |i| {
                indices[i] = control.next_command_index + i;
                commands[i] = control.records.items[control.next_command_index + i].command;
            }
            control.next_command_index += count;

            control.unlock();
            const accepted = p.submit(indices[0..count], commands[0..count]);
            const block = p.run.pull(slot.bytes, ring.slot_epochs) catch |e| {
                const f = p.runFailure(e);
                control.lock();
                return control.fail(f.reason, f.message);
            };
            if (block.failed == null and block.epochs != 0) p.drain();
            control.lock();

            for (block.applied, accepted[0..block.applied.len]) |applied, index| {
                control.records.items[index].applied = .{ .epoch = .of(applied.epoch.ms) };
            }

            if (block.failed) |e| {
                const f = p.runFailure(e);
                return control.fail(f.reason, f.message);
            }
            if (block.epochs == 0) {
                control.finishCommands(.completed);
                slot.epochs = 0;
                ended = true;
            } else {
                slot.first = .of(block.epoch_first.ms);
                slot.epochs = block.epochs;
                slot.clipped = block.clipped;
                slot.channels = p.channels;
            }

            slots.publish(slot, generation);
            control.wake();
        }
    }

    fn submit(p: *Producer, indices: []usize, commands: []const Command) []const usize {
        const control = p.control;
        var accepted: usize = 0;
        for (indices, commands) |index, command| {
            const given = toRun(command) catch {
                control.lock();
                defer control.unlock();
                control.records.items[index].applied = .{ .rejected = "malformed command" };
                continue;
            };
            p.run.submit(given) catch |e| {
                control.lock();
                defer control.unlock();
                if (e == error.TooManyPending) {
                    control.next_command_index = index;
                    break;
                }
                control.records.items[index].applied = .{ .rejected = control.keep(p.formatError("submit rejected: {s}", .{@errorName(e)})) };
                continue;
            };
            indices[accepted] = index;
            accepted += 1;
        }
        return indices[0..accepted];
    }

    fn enter(p: *Producer, target: Epoch, generation: u32) ?status.Failure {
        const control = p.control;
        const dest = @max(target.index(), p.run.epoch.ms);
        while (true) {
            const step = @min(dest, p.run.epoch.ms + chunk_epochs);
            p.run.seek(.{ .ms = step }) catch |e| return p.runFailure(e);
            p.channels = .{};
            p.drain();
            if (step == dest) return null;
            control.lock();
            defer control.unlock();
            if (!control.producing or control.handoff.ready.ring.generation != generation) return null;
        }
    }

    fn drain(p: *Producer) void {
        while (p.run.nextEvent()) |event| switch (event) {
            .channel_added => |added| p.channels.set(added.key, true),
            .channel_removed => |removed| p.channels.set(removed.key, false),
            else => {},
        };
    }

    fn runFailure(p: *Producer, e: (pharos.engine.run.SeekError || error{BufferTooSmall})) status.Failure {
        const message = if (e == error.OutOfMemory) "out of memory" else p.formatError("epoch {d} of {d} could not be generated: {s} ({s})", .{
            p.run.epoch.ms, p.run.info.span.epochs, @errorName(e), pharos.engine.run.reason(e),
        });
        return .{ .reason = if (e == error.OutOfMemory) .host else .generator, .message = message };
    }

    fn formatError(p: *Producer, comptime fmt: []const u8, args: anytype) []const u8 {
        return std.fmt.bufPrint(&p.error_buffer, fmt, args) catch "the generator's failure message is too long";
    }
};

fn toRun(command: Command) pharos.core.types.SatId.Error!pharos.bundle.command.Command {
    return .{ .action = switch (command) {
        .noise_floor_dbm_hz => |value| .{ .noise_floor_dbm_hz = value },
        .elevation_mask_deg => |value| .{ .elevation_mask = pharos.core.constants.deg2rad(value) },
        .power => |power| .{ .signal_power = .{
            .target = if (power.svid == 0) .{ .whole = power.system } else .{ .sat = try pharos.core.types.SatId.fromPrn(power.system, power.svid) },
            .level = switch (power.level) {
                .scenario => null,
                inline else => |value, unit| .{ .unit = @field(pharos.bundle.command.PowerUnit, @tagName(unit)), .value = value },
            },
        } },
    } };
}
