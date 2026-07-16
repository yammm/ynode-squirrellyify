import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

import { buildClientModules, compileClientModule } from "../src/client-module.js";

const execFileAsync = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL("../src/client-module-cli.js", import.meta.url));

async function importModule(source) {
    const encoded = Buffer.from(source).toString("base64");
    return import(`data:text/javascript;base64,${encoded}`);
}

async function createTempDir(t) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "squirrellyify-client-test-"));
    t.after(async () => {
        await fs.rm(dir, { recursive: true, force: true });
    });
    return dir;
}

test("compiles named loop and empty-state templates into a CSP-friendly render object", async () => {
    const source = await compileClientModule({
        templates: {
            tableBody: `{{@ if(it.rows.length > 0) }}{{@ each(it.rows) => row }}<tr><td>{{ row.name }}</td></tr>{{/ each }}{{# else }}<tr><td>Empty</td></tr>{{/ if }}`,
        },
    });

    assert.doesNotMatch(source, /\b(?:eval|new Function|Sqrl\.compile)\b/);
    const clientModule = await importModule(source);
    assert.equal(Object.isFrozen(clientModule.render), true);
    assert.equal(
        clientModule.render.tableBody({ rows: [{ name: "A&B" }, { name: "<Admin>" }] }),
        "<tr><td>A&amp;B</td></tr><tr><td>&lt;Admin&gt;</td></tr>",
    );
    assert.equal(clientModule.render.tableBody({ rows: [] }), "<tr><td>Empty</td></tr>");
});

test("compiles elif conditional branches", async () => {
    const source = await compileClientModule({
        templates: {
            status: `{{@ if(it.status === "ready") }}Ready{{# elif(it.status === "blocked") }}Blocked{{# else }}Unknown{{/ if }}`,
        },
    });

    const clientModule = await importModule(source);
    assert.equal(clientModule.render.status({ status: "ready" }), "Ready");
    assert.equal(clientModule.render.status({ status: "blocked" }), "Blocked");
    assert.equal(clientModule.render.status({ status: "other" }), "Unknown");
});

test("emits multiple named renderers in deterministic order", async () => {
    const first = await compileClientModule({
        templates: {
            summary: "<strong>{{ it.total }}</strong>",
            filterChips: "<span>{{ it.label }}</span>",
        },
    });
    const second = await compileClientModule({
        templates: {
            filterChips: "<span>{{ it.label }}</span>",
            summary: "<strong>{{ it.total }}</strong>",
        },
    });

    assert.equal(first, second);
    const clientModule = await importModule(first);
    assert.deepEqual(Object.keys(clientModule.render), ["filterChips", "summary"]);
    assert.equal(clientModule.render.summary({ total: 4 }), "<strong>4</strong>");
    assert.equal(clientModule.render.filterChips({ label: "Open" }), "<span>Open</span>");
});

test("embeds explicit browser-safe custom filters and helpers", async () => {
    const source = await compileClientModule({
        templates: {
            total: "{{ it.amount | currency }} {{@ emphasize(it.status) /}}",
        },
        filters: {
            currency(value) {
                return `$${Number(value).toFixed(2)}`;
            },
        },
        helpers: {
            emphasize(content) {
                return String(content.params[0]).toUpperCase();
            },
        },
    });

    const clientModule = await importModule(source);
    assert.equal(clientModule.render.total({ amount: 12.5, status: "ready" }), "$12.50 READY");
});

test("allows templates in one module to include each other", async () => {
    const source = await compileClientModule({
        templates: {
            row: "<li>{{ it.name }}</li>",
            rows: '<ul>{{@ each(it.rows) => row }}{{@ include("row", row) /}}{{/ each }}</ul>',
        },
    });

    const clientModule = await importModule(source);
    assert.equal(
        clientModule.render.rows({ rows: [{ name: "One" }, { name: "Two" }] }),
        "<ul><li>One</li><li>Two</li></ul>",
    );
});

test("reads explicitly declared template files", async (t) => {
    const dir = await createTempDir(t);
    const templatePath = path.join(dir, "summary.sqrl");
    await fs.writeFile(templatePath, "<strong>{{ it.total }}</strong>", "utf8");

    const source = await compileClientModule({
        templates: {
            summary: { file: templatePath },
        },
    });
    const clientModule = await importModule(source);
    assert.equal(clientModule.render.summary({ total: 9 }), "<strong>9</strong>");
});

test("writes named client modules during a build", async (t) => {
    const dir = await createTempDir(t);
    const templatePath = path.join(dir, "views", "status.sqrl");
    await fs.mkdir(path.dirname(templatePath), { recursive: true });
    await fs.writeFile(templatePath, "<span>{{ it.status }}</span>", "utf8");

    const built = await buildClientModules({
        cwd: dir,
        modules: {
            status: {
                output: "public/sqrl/status.js",
                templates: {
                    badge: { file: "views/status.sqrl" },
                },
            },
        },
    });

    const output = path.join(dir, "public", "sqrl", "status.js");
    const source = await fs.readFile(output, "utf8");
    assert.deepEqual(built, [
        {
            name: "status",
            output,
            bytes: Buffer.byteLength(source),
        },
    ]);
    const clientModule = await importModule(source);
    assert.equal(clientModule.render.badge({ status: "Ready" }), "<span>Ready</span>");
});

test("CLI resolves template and output paths from its config file", async (t) => {
    const dir = await createTempDir(t);
    const buildDir = path.join(dir, "build");
    const viewsDir = path.join(dir, "views");
    await fs.mkdir(buildDir, { recursive: true });
    await fs.mkdir(viewsDir, { recursive: true });
    await fs.writeFile(path.join(viewsDir, "summary.sqrl"), "<b>{{ it.total }}</b>", "utf8");
    const configPath = path.join(buildDir, "squirrelly-client.config.mjs");
    await fs.writeFile(
        configPath,
        `export default {
            modules: {
                history: {
                    output: "../public/history.js",
                    templates: { summary: { file: "../views/summary.sqrl" } }
                }
            }
        };`,
        "utf8",
    );

    const { stdout } = await execFileAsync(process.execPath, [CLI_PATH, configPath], {
        cwd: os.tmpdir(),
    });
    const output = path.join(dir, "public", "history.js");
    assert.equal(stdout.includes(`Built history: ${output}`), true);
    const source = await fs.readFile(output, "utf8");
    const clientModule = await importModule(source);
    assert.equal(clientModule.render.summary({ total: 12 }), "<b>12</b>");
});

test("compiles every module before replacing existing build output", async (t) => {
    const dir = await createTempDir(t);
    const output = path.join(dir, "public", "first.js");
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, "existing output", "utf8");

    await assert.rejects(
        () =>
            buildClientModules({
                cwd: dir,
                modules: {
                    first: {
                        output: "public/first.js",
                        templates: { page: "replacement output" },
                    },
                    second: {
                        output: "public/second.js",
                        templates: {
                            page: "{{@ if(it.ready) }}Ready{{# elseif(it.blocked) }}Blocked{{/ if }}",
                        },
                    },
                },
            }),
        /invalid conditional block "elseif"/,
    );
    assert.equal(await fs.readFile(output, "utf8"), "existing output");
    await assert.rejects(() => fs.access(path.join(dir, "public", "second.js")), {
        code: "ENOENT",
    });
});

test("rejects unsupported or incomplete client module definitions", async () => {
    await assert.rejects(() => compileClientModule(), /templates must be a plain object/);
    await assert.rejects(
        () => compileClientModule({ templates: {} }),
        /at least one named template/,
    );
    await assert.rejects(
        () => compileClientModule({ templates: { "table-body": "ok" } }),
        /valid JavaScript identifier/,
    );
    await assert.rejects(
        () => compileClientModule({ templates: { page: { source: "a", file: "b" } } }),
        /exactly one of source or file/,
    );
    await assert.rejects(
        () => compileClientModule({ templates: { page: '{{@ includeFile("row", it) /}}' } }),
        /unsupported client helper "includeFile"/,
    );
    await assert.rejects(
        () =>
            compileClientModule({
                templates: {
                    page: "{{@ if(it.ready) }}Ready{{# elseif(it.blocked) }}Blocked{{/ if }}",
                },
            }),
        /invalid conditional block "elseif"; use "elif"/,
    );
    await assert.rejects(
        () =>
            compileClientModule({
                templates: {
                    page: "{{@ if(it.ready) }}Ready{{# elf(it.blocked) }}Blocked{{/ if }}",
                },
            }),
        /invalid conditional block "elf"; use "elif"/,
    );
    await assert.rejects(
        () => compileClientModule({ templates: { page: "{{ it.name | missing }}" } }),
        /filter "missing" without providing it/,
    );
    await assert.rejects(
        () => compileClientModule({ templates: { page: "{{@ missing(it) /}}" } }),
        /helper "missing" without providing it/,
    );
    await assert.rejects(
        () => compileClientModule({ templates: { page: "ok" }, helpers: { each() {} } }),
        /cannot override a built-in/,
    );
    await assert.rejects(
        () => compileClientModule({ templates: { page: "ok" }, filters: { e() {} } }),
        /cannot override a built-in/,
    );
    await assert.rejects(
        () =>
            compileClientModule({
                templates: { page: "ok" },
                filters: { async value() {} },
            }),
        /must be synchronous/,
    );
    await assert.rejects(
        () => compileClientModule({ templates: { page: "ok" }, config: { async: true } }),
        /do not support async/,
    );
    await assert.rejects(
        () => compileClientModule({ templates: { page: "ok" }, config: { useWith: true } }),
        /do not support Squirrelly useWith/,
    );
    await assert.rejects(
        () => buildClientModules({ modules: {} }),
        /at least one named client module/,
    );
    await assert.rejects(
        () =>
            buildClientModules({
                modules: {
                    first: { output: "same.js", templates: { page: "First" } },
                    second: { output: "same.js", templates: { page: "Second" } },
                },
            }),
        /target the same output/,
    );
});
