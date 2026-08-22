import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { SourceMap } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

import Sqrl from "squirrelly";

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

test("serializes method-shorthand filters and helpers regardless of body contents", async () => {
    const source = await compileClientModule({
        templates: {
            names: "{{ it.rows | names }} {{@ shout(it.rows) /}}",
        },
        filters: {
            // Method shorthand whose body contains an arrow — the shorthand
            // itself must still serialize as a standalone function.
            names(rows) {
                return rows.map((row) => row.name).join(", ");
            },
        },
        helpers: {
            shout(content) {
                return content.params[0].map((row) => row.name.toUpperCase()).join("!");
            },
        },
    });

    const clientModule = await importModule(source);
    assert.equal(
        clientModule.render.names({ rows: [{ name: "Ada" }, { name: "Lin" }] }),
        "Ada, Lin ADA!LIN",
    );
});

test("serializes modern callable forms without confusing names or comments for syntax", async () => {
    const methods = {
        default(value) {
            return `default:${value}`;
        },
        async(value) {
            return `named-async:${value}`;
        },
        "kebab-case"(content) {
            return `quoted:${content.params[0]}`;
        },
        nativeComment(value) {
            // The text [native code] in a valid function must not make it non-serializable.
            return `comment:${value}`;
        },
    };
    const source = await compileClientModule({
        templates: {
            callables:
                "{{ it.value | reserved }}|{{ it.value | namedAsync }}|{{ it.value | arrow }}|{{ it.value | comment }}|{{@ quoted(it.value) /}}",
        },
        filters: {
            reserved: methods.default,
            namedAsync: methods.async,
            arrow: (value) => `arrow:${value}`,
            comment: methods.nativeComment,
        },
        helpers: {
            quoted: methods["kebab-case"],
        },
    });

    const clientModule = await importModule(source);
    assert.equal(
        clientModule.render.callables({ value: "x" }),
        "default:x|named-async:x|arrow:x|comment:x|quoted:x",
    );
});

test("rejects callable forms that cannot be safely reconstructed in a browser module", async () => {
    const computedName = "computed";
    const computedMethod = {
        [computedName](value) {
            return value;
        },
    }[computedName];
    const accessor = Object.getOwnPropertyDescriptor(
        {
            get value() {
                return "value";
            },
        },
        "value",
    ).get;

    await assert.rejects(
        () =>
            compileClientModule({ templates: { page: "ok" }, filters: { value: class Value {} } }),
        /not a class/,
    );
    await assert.rejects(
        () =>
            compileClientModule({
                templates: { page: "ok" },
                filters: { value: function* value() {} },
            }),
        /generator function/,
    );
    await assert.rejects(
        () => compileClientModule({ templates: { page: "ok" }, filters: { value: accessor } }),
        /accessor function/,
    );
    await assert.rejects(
        () =>
            compileClientModule({ templates: { page: "ok" }, filters: { value: computedMethod } }),
        /computed method name/,
    );
    await assert.rejects(
        () =>
            compileClientModule({
                templates: { page: "ok" },
                filters: { value: Math.max.bind(null) },
            }),
        /serializable browser-safe JavaScript/,
    );
});

test("renders explicitly async filters, helpers, loops, includes, and empty collections", async () => {
    const asyncFilters = {
        async lookup(value) {
            return String(value).toUpperCase();
        },
    };
    const source = await compileClientModule({
        config: { async: true },
        templates: {
            row: "<li>{{ it.name | async lookup }}</li>",
            rows: '{{@ async each(it.rows) => row }}{{@ async include("row", row) /}}{{/ each }}{{@ async delay(it.suffix) /}}',
            empty: "{{@ async foreach(it.values) => key, value }}{{ key }}={{ value }}{{/ foreach }}",
        },
        filters: {
            lookup: asyncFilters.lookup,
        },
        helpers: {
            delay: async (content) => Promise.resolve(content.params[0]),
        },
    });

    const clientModule = await importModule(source);
    assert.equal(
        await clientModule.render.rows({ rows: [{ name: "Ada" }, { name: "Lin" }], suffix: "!" }),
        "<li>ADA</li><li>LIN</li>!",
    );
    assert.equal(await clientModule.render.empty({ values: {} }), "");
});

test("keeps every renderer promise-based in an async client module", async () => {
    const source = await compileClientModule({
        config: { async: true },
        templates: { message: "Hello {{ it.name }}" },
    });
    const clientModule = await importModule(source);
    const rendered = clientModule.render.message({ name: "Ada" });
    assert.equal(rendered instanceof Promise, true);
    assert.equal(await rendered, "Hello Ada");
});

test("rejects missing async markers before emitting invalid client modules", async () => {
    const options = {
        config: { async: true },
        filters: { lookup: async (value) => value },
    };
    await assert.rejects(
        () => compileClientModule({ ...options, templates: { page: "{{ it.value | lookup }}" } }),
        /must call async filter "lookup" with the Squirrelly async marker/,
    );
    await assert.rejects(
        () =>
            compileClientModule({
                ...options,
                templates: {
                    page: "{{@ each(it.rows) => row }}{{ row | async lookup }}{{/ each }}",
                },
            }),
        /must mark helper "each" async/,
    );
    await assert.rejects(
        () =>
            compileClientModule({
                config: { async: true },
                templates: { row: "row", page: '{{@ include("row", it) /}}' },
            }),
        /must call include with the Squirrelly async marker/,
    );
    await assert.rejects(
        () =>
            compileClientModule({
                ...options,
                templates: {
                    page: "{{@ if(it.ready) }}{{ it.value | async lookup }}{{# else }}{{ it.value | missing }}{{/ if }}",
                },
            }),
        /filter "missing" without providing it/,
    );
});

test("safe filter bypasses escaping exactly like the server", async () => {
    const source = await compileClientModule({
        templates: {
            trusted: "{{ it.html | safe }}|{{ it.html }}",
        },
    });

    const clientModule = await importModule(source);
    assert.equal(
        clientModule.render.trusted({ html: "<b>x</b>" }),
        "<b>x</b>|&lt;b&gt;x&lt;/b&gt;",
    );
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
    const declaration = path.join(dir, "public", "sqrl", "status.d.ts");
    const sourceMapPath = `${output}.map`;
    const originalMtime = (await fs.stat(output, { bigint: true })).mtimeNs;
    assert.deepEqual(built, [
        {
            name: "status",
            output,
            bytes: Buffer.byteLength(source),
            declaration,
            declarationBytes: Buffer.byteLength(await fs.readFile(declaration, "utf8")),
            sourceMap: sourceMapPath,
            sourceMapBytes: Buffer.byteLength(await fs.readFile(sourceMapPath, "utf8")),
            written: true,
        },
    ]);
    assert.match(source, /\/\/# sourceMappingURL=status\.js\.map/);
    assert.match(
        await fs.readFile(declaration, "utf8"),
        /badge\(data: Record<string, unknown>\): string/,
    );
    const rawSourceMap = JSON.parse(await fs.readFile(sourceMapPath, "utf8"));
    const generatedLine = source.split("\n").findIndex((line) => line.includes("it.status"));
    const generatedColumn = source.split("\n")[generatedLine].indexOf("it.status");
    const mapped = new SourceMap(rawSourceMap).findEntry(generatedLine, generatedColumn);
    assert.equal(mapped.originalSource, "../../views/status.sqrl");
    assert.equal(mapped.originalLine, 0);
    assert.equal(mapped.originalColumn, 6);
    const clientModule = await importModule(source);
    assert.equal(clientModule.render.badge({ status: "Ready" }), "<span>Ready</span>");

    const rebuilt = await buildClientModules({
        cwd: dir,
        modules: {
            status: {
                output: "public/sqrl/status.js",
                templates: { badge: { file: "views/status.sqrl" } },
            },
        },
    });
    assert.equal(rebuilt[0].written, false);
    assert.equal((await fs.stat(output, { bigint: true })).mtimeNs, originalMtime);
});

test("emits promise-returning declarations for async client modules", async (t) => {
    const dir = await createTempDir(t);
    const [built] = await buildClientModules({
        cwd: dir,
        modules: {
            asyncPage: {
                output: "public/async-page.js",
                config: { async: true },
                templates: { page: "{{ it.value | async resolve }}" },
                filters: { resolve: async (value) => value },
            },
        },
    });
    assert.match(
        await fs.readFile(built.declaration, "utf8"),
        /page\(data: Record<string, unknown>\): Promise<string>/,
    );
    const sourceMap = JSON.parse(await fs.readFile(built.sourceMap, "utf8"));
    assert.deepEqual(sourceMap.sources, ["squirrellyify:///asyncPage/page.sqrl"]);
});

test("check mode reports stale artifacts without replacing existing output", async (t) => {
    const dir = await createTempDir(t);
    const templatePath = path.join(dir, "page.sqrl");
    const options = {
        cwd: dir,
        modules: {
            page: {
                output: "public/page.js",
                templates: { page: { file: "page.sqrl" } },
            },
        },
    };
    await fs.writeFile(templatePath, "First", "utf8");
    const [built] = await buildClientModules(options);
    const original = await fs.readFile(built.output, "utf8");
    const [checked] = await buildClientModules({ ...options, check: true });
    assert.equal(checked.written, false);

    await fs.writeFile(templatePath, "Second", "utf8");
    await assert.rejects(
        () => buildClientModules({ ...options, check: true }),
        (error) =>
            error.code === "ERR_CLIENT_MODULES_OUT_OF_DATE" && error.stale.includes(built.output),
    );
    assert.equal(await fs.readFile(built.output, "utf8"), original);
});

test("supports custom declaration paths and source-map opt-out", async (t) => {
    const dir = await createTempDir(t);
    const [built] = await buildClientModules({
        cwd: dir,
        modules: {
            page: {
                output: "public/page.js",
                declaration: "types/page.generated.d.ts",
                sourceMap: false,
                templates: { page: "Hello {{ it.name }}" },
            },
        },
    });

    assert.equal(built.declaration, path.join(dir, "types", "page.generated.d.ts"));
    assert.equal(built.sourceMap, undefined);
    assert.doesNotMatch(await fs.readFile(built.output, "utf8"), /sourceMappingURL/);
    await assert.rejects(() => fs.access(`${built.output}.map`), { code: "ENOENT" });
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

    const checked = await execFileAsync(process.execPath, [CLI_PATH, "--check", configPath], {
        cwd: os.tmpdir(),
    });
    assert.match(checked.stdout, /Checked history:/);

    await fs.writeFile(path.join(viewsDir, "summary.sqrl"), "<i>{{ it.total }}</i>", "utf8");
    await assert.rejects(
        () =>
            execFileAsync(process.execPath, [CLI_PATH, "--check", configPath], {
                cwd: os.tmpdir(),
            }),
        (error) => error.code === 1 && error.stderr.includes("Client module build is out of date"),
    );
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
        () =>
            compileClientModule({
                templates: { page: "ok" },
                filters: { value: async (input) => input },
            }),
        /must be synchronous/,
    );
    await assert.rejects(
        () => compileClientModule({ templates: { page: "ok" }, config: { useWith: true } }),
        /do not support Squirrelly useWith/,
    );
    await assert.rejects(
        () => compileClientModule({ templates: { page: "ok" }, config: { async: "yes" } }),
        /config.async must be a boolean/,
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
        /artifact collision/,
    );
});

test("client renders match server renders when a tag body contains the close delimiter in a string", async () => {
    const source = 'A {{ it.a + "}} {{" }} B';
    const data = { a: "v" };
    const moduleSource = await compileClientModule({ templates: { page: source } });
    const { render } = await importModule(moduleSource);
    assert.equal(render.page(data), Sqrl.render(source, data));
});

test("client renders preserve whitespace-control trimming exactly like the server", async () => {
    const cases = [
        { source: "Hello   {{_ it.name }}!", data: { name: "World" } },
        { source: "Hello\n{{- it.name }}!", data: { name: "World" } },
        { source: "{{ it.name _}}   \n  tail", data: { name: "World" } },
        {
            source: "a   {{_ it.first _}}   b   {{_ it.second }}",
            data: { first: "1", second: "2" },
        },
    ];

    for (const { source, data } of cases) {
        const moduleSource = await compileClientModule({ templates: { page: source } });
        const { render } = await importModule(moduleSource);
        assert.equal(render.page(data), Sqrl.render(source, data), `divergence for: ${source}`);
    }
});
