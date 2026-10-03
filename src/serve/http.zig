const std = @import("std");
const Io = std.Io;
const core = @import("core");
const Host = core.host.Host;
const Request = std.http.Server.Request;
const bufPrint = std.fmt.bufPrint;
const comptimePrint = std.fmt.comptimePrint;

const config_limit = 1024;
const line_limit = 1024;
const bundle_limit = 1 << 30;
const bearer = "Bearer ";

const ListenError = Io.net.IpAddress.ListenError || std.posix.SetSockOptError;

const Route = enum { run, command, stop, cancel, status, other };
const Origin = union(enum) { absent, rejected, allowed: []const u8 };

fn routeOf(method: std.http.Method, target: []const u8) Route {
    const path = target[0 .. std.mem.indexOfScalar(u8, target, '?') orelse target.len];
    if (method == .GET and std.mem.eql(u8, path, "/status")) return .status;
    if (method != .POST) return .other;
    if (std.mem.eql(u8, path, "/run")) return .run;
    if (std.mem.eql(u8, path, "/command")) return .command;
    if (std.mem.eql(u8, path, "/stop")) return .stop;
    if (std.mem.eql(u8, path, "/cancel")) return .cancel;
    return .other;
}

const Reply = struct {
    request: *Request,
    headers: [6]std.http.Header = undefined,
    count: usize = 0,
    keep: bool = true,

    fn add(reply: *Reply, name: []const u8, value: []const u8) void {
        reply.headers[reply.count] = .{ .name = name, .value = value };
        reply.count += 1;
    }

    fn send(reply: *Reply, status: std.http.Status, body: []const u8) !void {
        if (body.len > 0) reply.add("content-type", "application/json");
        try reply.request.respond(body, .{
            .status = status,
            .keep_alive = reply.keep,
            .extra_headers = reply.headers[0..reply.count],
        });
    }

    fn fail(reply: *Reply, status: std.http.Status, message: []const u8) !void {
        var buffer: [1024]u8 = undefined;
        var w: Io.Writer = .fixed(&buffer);
        const body = if (std.json.Stringify.value(.{ .@"error" = message }, .{}, &w))
            w.buffered()
        else |_|
            "{\"error\":\"the refusal is too long to show\"}";
        try reply.send(status, body);
    }
};

const Head = struct {
    route: Route,
    options: bool,
    body: bool,
    origin: Origin = .absent,
    admitted: bool = false,
    config: ?[]const u8 = null,
    config_long: bool = false,
    config_buffer: [config_limit]u8 = undefined,

    fn read(head: *Head, request: *const Request, host: *const Host) void {
        var it = request.iterateHeaders();
        while (it.next()) |h| {
            if (std.ascii.eqlIgnoreCase(h.name, "origin")) {
                head.origin = if (host.allowedOrigin(h.value)) |listed| .{ .allowed = listed } else .rejected;
            } else if (std.ascii.eqlIgnoreCase(h.name, "authorization")) {
                head.admitted = std.mem.startsWith(u8, h.value, bearer) and host.admits(h.value[bearer.len..]);
            } else if (std.ascii.eqlIgnoreCase(h.name, "loomsky-config")) {
                head.config_long = h.value.len > config_limit;
                if (head.config_long) continue;
                @memcpy(head.config_buffer[0..h.value.len], h.value);
                head.config = head.config_buffer[0..h.value.len];
            }
        }
    }
};

pub fn Server(comptime T: type) type {
    return struct {
        const Self = @This();

        io: Io,
        gpa: std.mem.Allocator,
        host: *const Host,
        transmitter: *T,

        pub fn listen(io: Io, address: Io.net.IpAddress) ListenError!Io.net.Server {
            var listener = try address.listen(io, .{ .reuse_address = true });
            errdefer listener.deinit(io);
            if (@hasDecl(std.posix.SO, "REUSEPORT")) {
                try std.posix.setsockopt(listener.socket.handle, std.posix.SOL.SOCKET, std.posix.SO.REUSEPORT, &std.mem.toBytes(@as(c_int, 0)));
            }
            return listener;
        }

        pub fn serve(io: Io, gpa: std.mem.Allocator, listener: *Io.net.Server, host: *const Host, transmitter: *T) void {
            const self: Self = .{ .io = io, .gpa = gpa, .host = host, .transmitter = transmitter };
            var group: Io.Group = .init;
            defer group.cancel(io);
            while (true) {
                const stream = listener.accept(io) catch |e| switch (e) {
                    error.Canceled => return,
                    else => {
                        io.sleep(.fromMilliseconds(10), .awake) catch return;
                        continue;
                    },
                };
                group.concurrent(io, connection, .{ &self, stream }) catch stream.close(io);
            }
        }

        fn connection(self: *const Self, stream: Io.net.Stream) void {
            defer stream.close(self.io);
            var in: [16 * 1024]u8 = undefined;
            var out: [16 * 1024]u8 = undefined;
            var reader = stream.reader(self.io, &in);
            var writer = stream.writer(self.io, &out);
            var http: std.http.Server = .init(&reader.interface, &writer.interface);
            while (true) {
                var request = http.receiveHead() catch return;
                const keep = self.handle(&request) catch return;
                if (!keep) return;
            }
        }

        fn handle(self: *const Self, request: *Request) !bool {
            var head: Head = .{
                .route = routeOf(request.head.method, request.head.target),
                .options = request.head.method == .OPTIONS,
                .body = request.head.method.requestHasBody(),
            };
            head.read(request, self.host);

            var reply: Reply = .{ .request = request, .keep = !head.body };
            switch (head.origin) {
                .absent => {},
                .rejected => {
                    try reply.fail(.forbidden, "the origin is not listed in the host file");
                    return reply.keep;
                },
                .allowed => |origin| {
                    reply.add("access-control-allow-origin", origin);
                    reply.add("vary", "origin");
                },
            }

            if (head.options) {
                reply.add("access-control-allow-methods", "GET, POST");
                reply.add("access-control-allow-headers", "authorization, content-type, loomsky-config");
                reply.add("access-control-max-age", "600");
                try reply.send(.no_content, "");
                return reply.keep;
            }

            if (!head.admitted) {
                try reply.fail(.unauthorized, "a missing or wrong token");
                return reply.keep;
            }

            if (head.body and head.route != .other and request.head.transfer_encoding != .none) {
                request.head.expect = null;
                try reply.fail(.bad_request, "transfer-encoding is not supported");
                return reply.keep;
            }

            switch (head.route) {
                .status => try self.status(&reply),
                .run => try self.run(&reply, &head),
                .command => try self.command(&reply),
                .stop => try self.stop(&reply),
                .cancel => try self.cancel(&reply),
                .other => try reply.fail(.not_found, "no such call"),
            }
            return reply.keep;
        }

        fn small(reply: *Reply, buffer: []u8, comptime name: []const u8) !?[]u8 {
            const length = reply.request.head.content_length orelse {
                try reply.fail(.bad_request, "the " ++ name ++ " needs a content-length");
                return null;
            };
            if (length > buffer.len) {
                try reply.fail(.bad_request, comptimePrint("the " ++ name ++ " exceeds {d} bytes", .{line_limit}));
                return null;
            }
            var chunk: [256]u8 = undefined;
            const body = try reply.request.readerExpectContinue(&chunk);
            try body.readSliceAll(buffer[0..length]);
            reply.keep = true;
            return buffer[0..length];
        }

        fn status(self: *const Self, reply: *Reply) !void {
            var out: Io.Writer.Allocating = .init(self.gpa);
            defer out.deinit();
            self.transmitter.snapshot(&out.writer) catch return reply.fail(.internal_server_error, "out of memory");
            reply.add("cache-control", "no-store");
            try reply.send(.ok, out.written());
        }

        fn run(self: *const Self, reply: *Reply, head: *const Head) !void {
            if (head.config_long) return reply.fail(.bad_request, comptimePrint("loomsky-config exceeds {d} bytes", .{config_limit}));
            const text = head.config orelse return reply.fail(.bad_request, "loomsky-config is missing");
            var memory: [16 * 1024]u8 = undefined;
            var fixed: std.heap.FixedBufferAllocator = .init(&memory);
            var why: []const u8 = "";
            const submission = core.config.Submission.parse(fixed.allocator(), text, &why) catch {
                var buffer: [384]u8 = undefined;
                return reply.fail(.bad_request, bufPrint(&buffer, "loomsky-config: {s}", .{why}) catch why);
            };

            const length = reply.request.head.content_length orelse return reply.fail(.bad_request, "the bundle needs a content-length");
            if (length > bundle_limit) return reply.fail(.bad_request, comptimePrint("the bundle exceeds {d} GiB", .{bundle_limit >> 30}));

            self.transmitter.reserve(submission.operation) catch |e| return reply.fail(.conflict, switch (e) {
                error.Busy => "a transmission lives or uploads",
                error.Other => "the operation is not the next operation of this boot",
                error.Closing => "the host is closing",
            });
            defer self.transmitter.release(submission.operation);

            const bundle = self.upload(reply, @intCast(length)) catch |e| switch (e) {
                error.OutOfMemory => return reply.fail(.internal_server_error, "out of memory for the bundle"),
                else => return e,
            };
            var owned = true;
            defer if (owned) self.gpa.free(bundle);

            const target = self.transmitter.submit(submission.operation, bundle, submission.config) catch |e| return reply.fail(.conflict, switch (e) {
                error.Other => "the operation was cancelled or superseded",
                error.Closing => "the host is closing",
            });
            owned = false;

            var buffer: [256]u8 = undefined;
            var writer: Io.Writer = .fixed(&buffer);
            try std.json.Stringify.value(.{ .operation = submission.operation, .target = target }, .{}, &writer);
            try reply.send(.accepted, writer.buffered());
        }

        fn upload(self: *const Self, reply: *Reply, length: usize) ![]u8 {
            const bundle = try self.gpa.alloc(u8, length);
            errdefer self.gpa.free(bundle);
            var chunk: [64 * 1024]u8 = undefined;
            const body = try reply.request.readerExpectContinue(&chunk);
            try body.readSliceAll(bundle);
            reply.keep = true;
            return bundle;
        }

        fn command(self: *const Self, reply: *Reply) !void {
            var buffer: [line_limit]u8 = undefined;
            const text = try small(reply, &buffer, "command") orelse return;

            var memory: [16 * 1024]u8 = undefined;
            var fixed: std.heap.FixedBufferAllocator = .init(&memory);
            var why: []const u8 = "";
            const cmd = core.command.Request.parse(fixed.allocator(), text, &why) catch {
                var message: [384]u8 = undefined;
                return reply.fail(.bad_request, bufPrint(&message, "the command: {s}", .{why}) catch why);
            };

            var out: Io.Writer.Allocating = .init(self.gpa);
            defer out.deinit();
            self.transmitter.command(cmd, &out.writer) catch |e| return switch (e) {
                error.Other => reply.fail(.conflict, "that run is not the current run"),
                error.Closed => reply.fail(.conflict, "the run no longer accepts commands"),
                error.ActionConflict => reply.fail(.conflict, "the actionId already identifies a different command in this run"),
                error.OutOfMemory, error.WriteFailed => reply.fail(.internal_server_error, "out of memory"),
            };
            try reply.send(.accepted, out.written());
        }

        fn stop(self: *const Self, reply: *Reply) !void {
            var buffer: [line_limit]u8 = undefined;
            const text = try small(reply, &buffer, "stop") orelse return;

            var memory: [4 * 1024]u8 = undefined;
            var fixed: std.heap.FixedBufferAllocator = .init(&memory);
            var why: []const u8 = "";
            const request = core.command.Stop.parse(fixed.allocator(), text, &why) catch {
                var message: [384]u8 = undefined;
                return reply.fail(.bad_request, bufPrint(&message, "the stop: {s}", .{why}) catch why);
            };

            self.transmitter.stop(request.target) catch return reply.fail(.conflict, "that run is not the current run");
            try reply.send(.accepted, "");
        }

        fn cancel(self: *const Self, reply: *Reply) !void {
            var buffer: [line_limit]u8 = undefined;
            const text = try small(reply, &buffer, "cancellation") orelse return;

            var memory: [4 * 1024]u8 = undefined;
            var fixed: std.heap.FixedBufferAllocator = .init(&memory);
            var why: []const u8 = "";
            const request = core.command.Cancel.parse(fixed.allocator(), text, &why) catch {
                var message: [384]u8 = undefined;
                return reply.fail(.bad_request, bufPrint(&message, "the cancellation: {s}", .{why}) catch why);
            };

            self.transmitter.cancel(request.operation) catch |e| return reply.fail(.conflict, switch (e) {
                error.Busy => "a transmission lives or uploads",
                error.Other => "the operation does not belong to this boot or its next sequence",
            });
            try reply.send(.accepted, "");
        }
    };
}
