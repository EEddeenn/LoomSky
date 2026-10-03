const std = @import("std");
const Io = std.Io;
const core = @import("core");
const ring = @import("ring.zig");
const Plan = @import("plan.zig").Plan;
const status = core.status;
const Config = core.config.Config;
const Failure = status.Failure;
const OperationId = core.identity.OperationId;
const RunId = core.identity.RunId;

pub const Job = struct { bundle: []u8, config: Config };

const Handoff = union(enum) {
    pending,
    ready: struct { plan: Plan, ring: ring.Ring },
    refused: Failure,
    failed: Failure,
};

const Planned = union(enum) { ready: Plan, outcome: status.Outcome };

pub const Taken = union(enum) { slot: *ring.Slot, stopped, failed: Failure };

pub const Control = struct {
    io: Io,
    gpa: std.mem.Allocator,
    mutex: Io.Mutex = .init,
    changed: Io.Condition = .init,
    arena: std.heap.ArenaAllocator,
    boot: core.identity.Boot,

    operation: ?status.Operation = null,
    job: ?Job = null,
    live: bool = false,
    run: u64 = 0,
    stop: bool = false,
    quit: bool = false,
    closed: bool = false,
    device: status.DeviceState = .opening,

    status: ?status.Status = null,
    label: [core.config.label_limit]u8 = undefined,
    records: std.ArrayList(status.Record) = .empty,
    next_command_index: usize = 0,
    commands_open: bool = false,

    handoff: Handoff = .pending,
    failure: ?Failure = null,
    producing: bool = false,

    pub fn init(io: Io, gpa: std.mem.Allocator, boot: u64) Control {
        return .{ .io = io, .gpa = gpa, .arena = .init(gpa), .boot = .{ .bits = boot } };
    }

    pub fn lock(self: *Control) void {
        self.mutex.lockUncancelable(self.io);
    }

    pub fn unlock(self: *Control) void {
        self.mutex.unlock(self.io);
    }

    pub fn wait(self: *Control) void {
        self.changed.waitUncancelable(self.io, &self.mutex);
    }

    pub fn wake(self: *Control) void {
        self.changed.broadcast(self.io);
    }

    pub fn keep(self: *Control, text: []const u8) []const u8 {
        return self.arena.allocator().dupe(u8, text) catch "out of memory";
    }

    pub fn reserve(self: *Control, id: OperationId) error{ Busy, Other, Closing }!void {
        if (self.quit or self.closed) return error.Closing;
        if (!self.isNext(id)) return error.Other;
        if (self.live or self.uploading()) return error.Busy;
        self.operation = .{ .id = id, .state = .uploading };
    }

    pub fn releaseUpload(self: *Control, id: OperationId) void {
        if (self.owns(id) and self.uploading()) self.operation.?.state = .rejected;
    }

    pub fn commit(self: *Control, id: OperationId, bundle: []u8, config: Config) error{ Other, Closing }!RunId {
        if (self.quit or self.closed) return error.Closing;
        if (!self.owns(id) or !self.uploading()) return error.Other;

        self.live = true;
        self.stop = false;
        self.run += 1;
        const target: RunId = .{ .boot = self.boot, .sequence = self.run };
        self.operation = .{ .id = id, .state = .{ .accepted = target } };

        _ = self.arena.reset(.retain_capacity);
        self.records = .empty;
        self.next_command_index = 0;
        self.commands_open = true;
        self.handoff = .pending;
        self.failure = null;

        var kept = config;
        if (config.label) |label| {
            @memcpy(self.label[0..label.len], label);
            kept.label = self.label[0..label.len];
        }

        self.status = .{ .config = kept };
        self.job = .{ .bundle = bundle, .config = kept };
        self.wake();
        return target;
    }

    pub fn cancel(self: *Control, id: OperationId) error{ Busy, Other }!void {
        if (id.boot.bits != self.boot.bits or id.sequence == 0) return error.Other;
        if (self.owns(id)) {
            switch (self.operation.?.state) {
                .uploading => self.operation.?.state = .cancelled,
                .accepted => self.requestStop(),
                .cancelled, .rejected => {},
            }
        } else if (id.sequence <= self.operationSequence()) {
            return;
        } else {
            if (!self.isNext(id)) return error.Other;
            if (self.live or self.uploading()) return error.Busy;
            self.operation = .{ .id = id, .state = .cancelled };
        }
        self.wake();
    }

    pub fn stopRun(self: *Control, target: RunId) error{Other}!void {
        if (!self.matches(target)) return error.Other;
        self.requestStop();
    }

    pub fn requestStop(self: *Control) void {
        self.closeCommands();
        if (self.live) self.stop = true;
        self.wake();
    }

    fn matches(self: *Control, target: RunId) bool {
        return target.boot.bits == self.boot.bits and target.sequence != 0 and target.sequence == self.run;
    }

    fn owns(self: *Control, id: OperationId) bool {
        return if (self.operation) |op| op.id.eql(id) else false;
    }

    fn uploading(self: *Control) bool {
        return if (self.operation) |op| op.state == .uploading else false;
    }

    fn operationSequence(self: *Control) u64 {
        return if (self.operation) |op| op.id.sequence else 0;
    }

    fn isNext(self: *Control, id: OperationId) bool {
        return id.boot.bits == self.boot.bits and id.sequence != 0 and id.sequence - 1 == self.operationSequence();
    }

    pub fn current(self: *Control) *status.Status {
        return &self.status.?;
    }

    pub fn record(self: *Control, request: core.command.Request) error{ Other, Closed, ActionConflict, OutOfMemory }!status.Record {
        if (!self.matches(request.target)) return error.Other;
        for (self.records.items) |entry| {
            if (!std.mem.eql(u8, entry.actionId, request.actionId)) continue;
            if (!std.meta.eql(entry.command, request.command)) return error.ActionConflict;
            return entry;
        }
        if (!self.commands_open) return error.Closed;
        const arena = self.arena.allocator();
        const entry: status.Record = .{ .actionId = try arena.dupe(u8, request.actionId), .command = request.command };
        try self.records.append(arena, entry);
        self.current().commands = self.records.items;
        self.wake();
        return entry;
    }

    pub fn closeCommands(self: *Control) void {
        self.commands_open = false;
    }

    pub fn finishCommands(self: *Control, reason: status.Discarded) void {
        self.closeCommands();
        for (self.records.items) |*entry| if (entry.applied == null) {
            entry.applied = .{ .discarded = reason };
        };
    }

    pub fn finish(self: *Control, outcome: status.Outcome) void {
        self.finishCommands(switch (outcome) {
            inline else => |_, kind| @field(status.Discarded, @tagName(kind)),
        });
        const s = self.current();
        s.state = .ended;
        s.outcome = outcome;
        self.live = false;
        self.producing = false;
        self.stop = false;
        self.wake();
    }

    pub fn awaitPlan(self: *Control) Planned {
        while (self.handoff == .pending and !self.stop) self.wait();
        return switch (self.handoff) {
            .pending => .{ .outcome = .stopped },
            .ready => |*ready| .{ .ready = ready.plan },
            .refused => |f| .{ .outcome = .{ .refused = f } },
            .failed => |f| .{ .outcome = .{ .failed = f } },
        };
    }

    pub fn offer(self: *Control, handoff: Handoff) void {
        if (handoff == .refused or handoff == .failed) self.closeCommands();
        self.handoff = switch (handoff) {
            .refused => |f| .{ .refused = .{ .reason = f.reason, .message = self.keep(f.message) } },
            .failed => |f| .{ .failed = .{ .reason = f.reason, .message = self.keep(f.message) } },
            else => handoff,
        };
        self.wake();
    }

    pub fn fail(self: *Control, reason: status.Reason, message: []const u8) void {
        self.closeCommands();
        if (self.failure == null) self.failure = .{ .reason = reason, .message = self.keep(message) };
        self.wake();
    }

    pub fn enter(self: *Control, target: core.time.Epoch) void {
        self.handoff.ready.ring.enter(target);
        self.wake();
    }

    pub fn take(self: *Control) Taken {
        while (true) {
            if (self.stop) return .stopped;
            if (self.failure) |f| return .{ .failed = f };
            if (self.handoff.ready.ring.take()) |slot| return .{ .slot = slot };
            self.wait();
        }
    }

    pub fn release(self: *Control, slot: *ring.Slot) void {
        ring.Ring.release(slot);
        self.wake();
    }
};
