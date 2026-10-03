const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{ .preferred_optimize_mode = .ReleaseSafe });
    const prefix = b.option([]const u8, "uhd", "the prefix the radio driver is installed under");
    const pharos = b.dependency("pharos", .{ .target = target, .optimize = .ReleaseFast });

    const core = b.createModule(.{
        .root_source_file = b.path("src/core/root.zig"),
        .target = target,
        .optimize = optimize,
        .imports = &.{.{ .name = "pharos_run", .module = pharos.module("pharos_run") }},
    });
    const transmit = b.createModule(.{
        .root_source_file = b.path("src/transmit/root.zig"),
        .target = target,
        .optimize = optimize,
        .imports = &.{
            .{ .name = "core", .module = core },
            .{ .name = "pharos_run", .module = pharos.module("pharos_run") },
        },
    });
    const serve = b.createModule(.{
        .root_source_file = b.path("src/serve/root.zig"),
        .target = target,
        .optimize = optimize,
        .imports = &.{.{ .name = "core", .module = core }},
    });

    const radio_header = b.addTranslateC(.{
        .root_source_file = b.addWriteFiles().add("uhd.h", "#include <uhd.h>\n"),
        .target = target,
        .optimize = optimize,
    });
    const radio = b.createModule(.{
        .root_source_file = b.path("src/uhd.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
        .imports = &.{
            .{ .name = "core", .module = core },
            .{ .name = "uhd_h", .module = radio_header.createModule() },
        },
    });
    if (prefix) |p| {
        radio_header.addIncludePath(.{ .cwd_relative = b.pathJoin(&.{ p, "include" }) });
        radio.addLibraryPath(.{ .cwd_relative = b.pathJoin(&.{ p, "lib" }) });
    }
    radio.linkSystemLibrary("uhd", .{ .use_pkg_config = .no });
    b.installArtifact(b.addExecutable(.{
        .name = "loomsky",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/main.zig"),
            .target = target,
            .optimize = optimize,
            .strip = true,
            .imports = &.{
                .{ .name = "core", .module = core },
                .{ .name = "transmit", .module = transmit },
                .{ .name = "serve", .module = serve },
                .{ .name = "uhd", .module = radio },
            },
        }),
    }));

    const page = b.dependency("pharos", .{ .optimize = .ReleaseFast });
    const web = b.step("web", "Install the Pharos WebAssembly products and schemas for the page");
    b.getInstallStep().dependOn(web);
    for ([_][]const u8{ "pharos_traj.wasm", "pharos_pack.wasm", "pharos_obs.wasm", "trajectory.schema.json", "scenario.schema.json" }) |name| {
        const asset = page.namedLazyPath(name);
        const producer = asset.generated.file.step;
        if (producer.cast(std.Build.Step.Compile)) |compile| compile.root_module.strip = true;
        for (producer.dependencies.items) |dependency| {
            if (dependency.cast(std.Build.Step.Compile)) |compile| compile.root_module.strip = true;
        }
        web.dependOn(&b.addInstallFile(asset, b.pathJoin(&.{ "web", name })).step);
    }

    const fmt_paths: []const []const u8 = &.{ "build.zig", "build.zig.zon", "src" };
    b.step("fmt-check", "Fail if any source is not zig fmt clean").dependOn(&b.addFmt(.{ .paths = fmt_paths, .check = true }).step);
    b.step("fmt", "Format build.zig, build.zig.zon and src/ in place").dependOn(&b.addFmt(.{ .paths = fmt_paths }).step);
}
