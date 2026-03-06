import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import squirrellyify from "../src/plugin.js";

function createFastifyHarness(parent = null) {
    const replyDecorators = new Map();
    const instance = {
        parent,
        log: {
            trace() {},
            error() {},
        },
        decorateReply(name, value) {
            replyDecorators.set(name, value);
        },
        decorate(name, value) {
            this[name] = value;
        },
    };

    return {
        instance,
        async register(options) {
            await squirrellyify(instance, options);
        },
        async render(template, data = {}) {
            const reply = {
                request: { server: instance },
                statusCode: 200,
                payload: undefined,
                contentType: undefined,
                type(value) {
                    this.contentType = value;
                    return this;
                },
                send(value) {
                    this.payload = value;
                    return value;
                },
                status(code) {
                    this.statusCode = code;
                    return this;
                },
                code(code) {
                    this.statusCode = code;
                    return this;
                },
            };
            reply.view = replyDecorators.get("view");
            assert.equal(typeof reply.view, "function");
            await reply.view.call(reply, template, data);
            return reply;
        },
    };
}

async function createTempDir(t) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "squirrellyify-test-"));
    t.after(async () => {
        await fs.rm(dir, { recursive: true, force: true });
    });
    return dir;
}

async function writeTemplate(baseDir, relativePath, content) {
    const fullPath = path.join(baseDir, relativePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, "utf8");
}

test("allows nested forward-slash template names and blocks traversal", async (t) => {
    const root = await createTempDir(t);
    const viewsDir = path.join(root, "views");
    await writeTemplate(viewsDir, "pages/home.sqrl", "<h1>Hello {{it.name}}</h1>");

    const app = createFastifyHarness();
    await app.register({ templates: viewsDir });

    const ok = await app.render("pages/home", { name: "World" });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.contentType, "text/html");
    assert.equal(ok.payload, "<h1>Hello World</h1>");

    const blocked = await app.render("../secret", {});
    assert.equal(blocked.statusCode, 500);
    assert.match(String(blocked.payload), /Illegal template name/);
});

test("validates plugin option types with clear registration errors", async () => {
    await assert.rejects(
        async () => {
            const app = createFastifyHarness();
            await app.register({ partialsRecursive: "yes" });
        },
        /Invalid option "partialsRecursive": expected a boolean/,
    );

    await assert.rejects(
        async () => {
            const app = createFastifyHarness();
            await app.register({ sqrl: { scope: "tenant" } });
        },
        /Invalid option "sqrl.scope": expected "global" or "scoped"/,
    );

    await assert.rejects(
        async () => {
            const app = createFastifyHarness();
            await app.register({ sqrl: { filters: { bad: "not-a-function" } } });
        },
        /Invalid option "sqrl.filters.bad": expected a function/,
    );
});

test("accepts defaultExtension with a leading dot", async (t) => {
    const root = await createTempDir(t);
    const viewsDir = path.join(root, "views");
    await writeTemplate(viewsDir, "page.html", "<h1>Dot Extension</h1>");

    const app = createFastifyHarness();
    await app.register({
        templates: viewsDir,
        defaultExtension: ".html",
    });

    const rendered = await app.render("page");
    assert.equal(rendered.statusCode, 200);
    assert.equal(rendered.payload, "<h1>Dot Extension</h1>");
});

test("renders async templates and layouts when sqrl.config.async is enabled", async (t) => {
    const root = await createTempDir(t);
    const viewsDir = path.join(root, "views");
    await writeTemplate(viewsDir, "layouts/main.sqrl", "<main>{{it.body | safe}}</main>");
    await writeTemplate(viewsDir, "pages/home.sqrl", "<h1>{{it.name}}</h1>");

    const app = createFastifyHarness();
    await app.register({
        templates: viewsDir,
        layout: "layouts/main",
        sqrl: {
            config: { async: true },
        },
    });

    const rendered = await app.render("pages/home", { name: "michael" });
    assert.equal(rendered.statusCode, 200);
    assert.equal(rendered.payload, "<main><h1>michael</h1></main>");
});

test("global mode shares helpers and filters across plugin registrations", async (t) => {
    const root = await createTempDir(t);
    const viewsA = path.join(root, "views-a");
    const viewsB = path.join(root, "views-b");
    await writeTemplate(viewsA, "page.sqrl", "{{it.word | sharedCase}}");
    await writeTemplate(viewsB, "page.sqrl", "{{it.word | sharedCase}}");

    const appA = createFastifyHarness();
    await appA.register({
        templates: viewsA,
        sqrl: {
            filters: {
                sharedCase(value) {
                    return `A:${value}`;
                },
            },
        },
    });

    const appB = createFastifyHarness();
    await appB.register({
        templates: viewsB,
        sqrl: {
            filters: {
                sharedCase(value) {
                    return `B:${value}`;
                },
            },
        },
    });

    const fromA = await appA.render("page", { word: "one" });
    const fromB = await appB.render("page", { word: "two" });
    assert.equal(fromA.payload, "B:one");
    assert.equal(fromB.payload, "B:two");
});

test("scoped mode isolates helpers and filters per registration", async (t) => {
    const root = await createTempDir(t);
    const viewsA = path.join(root, "views-a");
    const viewsB = path.join(root, "views-b");
    await writeTemplate(viewsA, "page.sqrl", "{{it.word | isolatedCase}}");
    await writeTemplate(viewsB, "page.sqrl", "{{it.word | isolatedCase}}");

    const appA = createFastifyHarness();
    await appA.register({
        templates: viewsA,
        sqrl: {
            scope: "scoped",
            filters: {
                isolatedCase(value) {
                    return `A:${value}`;
                },
            },
        },
    });

    const appB = createFastifyHarness();
    await appB.register({
        templates: viewsB,
        sqrl: {
            scope: "scoped",
            filters: {
                isolatedCase(value) {
                    return `B:${value}`;
                },
            },
        },
    });

    const fromA = await appA.render("page", { word: "one" });
    const fromB = await appB.render("page", { word: "two" });
    assert.equal(fromA.payload, "A:one");
    assert.equal(fromB.payload, "B:two");
});

test("runtime API in global mode updates filters across registrations", async (t) => {
    const root = await createTempDir(t);
    const viewsA = path.join(root, "views-a");
    const viewsB = path.join(root, "views-b");
    await writeTemplate(viewsA, "page.sqrl", "{{it.word | runtimeFilter}}");
    await writeTemplate(viewsB, "page.sqrl", "{{it.word | runtimeFilter}}");

    const appA = createFastifyHarness();
    await appA.register({ templates: viewsA });
    appA.instance.viewFilters.define("runtimeFilter", (value) => {
        return `G:${value}`;
    });

    const appB = createFastifyHarness();
    await appB.register({ templates: viewsB });

    const fromA = await appA.render("page", { word: "one" });
    const fromB = await appB.render("page", { word: "two" });
    assert.equal(fromA.payload, "G:one");
    assert.equal(fromB.payload, "G:two");
    assert.equal(typeof appB.instance.viewFilters.get("runtimeFilter"), "function");

    appA.instance.viewFilters.remove("runtimeFilter");
    const removed = await appB.render("page", { word: "two" });
    assert.equal(removed.statusCode, 500);
    assert.match(String(removed.payload), /Can't find filter 'runtimeFilter'/);
});

test("runtime API in scoped mode keeps filters isolated per registration", async (t) => {
    const root = await createTempDir(t);
    const viewsA = path.join(root, "views-a");
    const viewsB = path.join(root, "views-b");
    await writeTemplate(viewsA, "page.sqrl", "{{it.word | runtimeScoped}}");
    await writeTemplate(viewsB, "page.sqrl", "{{it.word | runtimeScoped}}");

    const appA = createFastifyHarness();
    await appA.register({
        templates: viewsA,
        sqrl: { scope: "scoped" },
    });
    appA.instance.viewFilters.define("runtimeScoped", (value) => {
        return `S:${value}`;
    });

    const appB = createFastifyHarness();
    await appB.register({
        templates: viewsB,
        sqrl: { scope: "scoped" },
    });

    const fromA = await appA.render("page", { word: "one" });
    const fromB = await appB.render("page", { word: "two" });
    assert.equal(fromA.payload, "S:one");
    assert.equal(fromB.statusCode, 500);
    assert.match(String(fromB.payload), /Can't find filter 'runtimeScoped'/);

    assert.equal(typeof appA.instance.viewFilters.get("runtimeScoped"), "function");
    assert.equal(appB.instance.viewFilters.get("runtimeScoped"), undefined);
});

test("runtime API in global mode shares partials across registrations", async (t) => {
    const root = await createTempDir(t);
    const viewsA = path.join(root, "views-a");
    const viewsB = path.join(root, "views-b");
    await writeTemplate(
        viewsA,
        "page.sqrl",
        "<section>{{@include('runtime/card', { word: it.word })/}}</section>",
    );
    await writeTemplate(
        viewsB,
        "page.sqrl",
        "<section>{{@include('runtime/card', { word: it.word })/}}</section>",
    );

    const appA = createFastifyHarness();
    await appA.register({ templates: viewsA });
    appA.instance.viewPartials.define("runtime/card", "<p>G:{{it.word}}</p>");

    const appB = createFastifyHarness();
    await appB.register({ templates: viewsB });

    const fromA = await appA.render("page", { word: "one" });
    const fromB = await appB.render("page", { word: "two" });
    assert.equal(fromA.payload, "<section><p>G:one</p></section>");
    assert.equal(fromB.payload, "<section><p>G:two</p></section>");
    assert.equal(typeof appB.instance.viewPartials.get("runtime/card"), "function");

    appA.instance.viewPartials.remove("runtime/card");
    const removed = await appB.render("page", { word: "two" });
    assert.equal(removed.statusCode, 500);
    assert.match(String(removed.payload), /runtime\/card/);
});

test("runtime API in scoped mode isolates partials per registration", async (t) => {
    const root = await createTempDir(t);
    const viewsA = path.join(root, "views-a");
    const viewsB = path.join(root, "views-b");
    await writeTemplate(
        viewsA,
        "page.sqrl",
        "<section>{{@include('runtime/card', { word: it.word })/}}</section>",
    );
    await writeTemplate(
        viewsB,
        "page.sqrl",
        "<section>{{@include('runtime/card', { word: it.word })/}}</section>",
    );

    const appA = createFastifyHarness();
    await appA.register({
        templates: viewsA,
        sqrl: { scope: "scoped" },
    });
    appA.instance.viewPartials.define("runtime/card", "<p>S:{{it.word}}</p>");

    const appB = createFastifyHarness();
    await appB.register({
        templates: viewsB,
        sqrl: { scope: "scoped" },
    });

    const fromA = await appA.render("page", { word: "one" });
    const fromB = await appB.render("page", { word: "two" });
    assert.equal(fromA.payload, "<section><p>S:one</p></section>");
    assert.equal(fromB.statusCode, 500);
    assert.match(String(fromB.payload), /runtime\/card/);
    assert.equal(typeof appA.instance.viewPartials.get("runtime/card"), "function");
    assert.equal(appB.instance.viewPartials.get("runtime/card"), undefined);
});

test("viewCache.clear invalidates cached templates after file changes", async (t) => {
    const root = await createTempDir(t);
    const viewsDir = path.join(root, "views");
    await writeTemplate(viewsDir, "page.sqrl", "<h1>Version A</h1>");

    const app = createFastifyHarness();
    await app.register({
        templates: viewsDir,
        cache: true,
    });

    const first = await app.render("page");
    assert.equal(first.statusCode, 200);
    assert.equal(first.payload, "<h1>Version A</h1>");

    await writeTemplate(viewsDir, "page.sqrl", "<h1>Version B</h1>");

    const cached = await app.render("page");
    assert.equal(cached.statusCode, 200);
    assert.equal(cached.payload, "<h1>Version A</h1>");
    assert.equal(typeof app.instance.viewCache.clear, "function");
    assert.equal(typeof app.instance.viewCache.stats, "function");

    const before = app.instance.viewCache.stats();
    assert.equal(before.enabled, true);
    assert.equal(before.templates > 0, true);

    app.instance.viewCache.clear();

    const after = app.instance.viewCache.stats();
    assert.equal(after.templates, 0);
    assert.equal(after.paths, 0);
    assert.equal(after.metadata, 0);

    const fresh = await app.render("page");
    assert.equal(fresh.statusCode, 200);
    assert.equal(fresh.payload, "<h1>Version B</h1>");
});

test("does not resolve page templates from partial directories", async (t) => {
    const root = await createTempDir(t);
    const viewsDir = path.join(root, "views");
    const partialsDir = path.join(root, "partials");
    await fs.mkdir(viewsDir, { recursive: true });
    await writeTemplate(partialsDir, "page.sqrl", "<h1>{{it.word}}</h1>");

    const app = createFastifyHarness();
    await app.register({
        templates: viewsDir,
        partials: partialsDir,
    });

    const rendered = await app.render("page", { word: "shadow" });
    assert.equal(rendered.statusCode, 500);
    assert.match(String(rendered.payload), /Template "page" not found/);
});

test("loads nested partials recursively using forward-slash names by default", async (t) => {
    const root = await createTempDir(t);
    const viewsDir = path.join(root, "views");
    const partialsDir = path.join(root, "partials");

    await writeTemplate(
        viewsDir,
        "page.sqrl",
        "<article>{{@include('cards/user-card', { name: it.name })/}}</article>",
    );
    await writeTemplate(partialsDir, "cards/user-card.sqrl", "<p>{{it.name}}</p>");

    const app = createFastifyHarness();
    await app.register({
        templates: viewsDir,
        partials: partialsDir,
    });

    const rendered = await app.render("page", { name: "Ana" });
    assert.equal(rendered.statusCode, 200);
    assert.equal(rendered.payload, "<article><p>Ana</p></article>");
});

test("can disable recursive partial loading with partialsRecursive=false", async (t) => {
    const root = await createTempDir(t);
    const viewsDir = path.join(root, "views");
    const partialsDir = path.join(root, "partials");

    await writeTemplate(
        viewsDir,
        "page.sqrl",
        "<article>{{@include('cards/user-card', { name: it.name })/}}</article>",
    );
    await writeTemplate(partialsDir, "cards/user-card.sqrl", "<p>{{it.name}}</p>");

    const app = createFastifyHarness();
    await app.register({
        templates: viewsDir,
        partials: partialsDir,
        partialsRecursive: false,
        sqrl: { scope: "scoped" },
    });

    const rendered = await app.render("page", { name: "Ana" });
    assert.equal(rendered.statusCode, 500);
    assert.match(String(rendered.payload), /cards\/user-card/);
});

test("supports partial namespace prefix using the partials directory basename", async (t) => {
    const root = await createTempDir(t);
    const viewsDir = path.join(root, "views");
    const partialsDir = path.join(root, "shared-partials");

    await writeTemplate(
        viewsDir,
        "page.sqrl",
        "<article>{{@include('shared-partials/cards/user-card', { name: it.name })/}}</article>",
    );
    await writeTemplate(partialsDir, "cards/user-card.sqrl", "<p>{{it.name}}</p>");

    const app = createFastifyHarness();
    await app.register({
        templates: viewsDir,
        partials: partialsDir,
        partialsNamespace: true,
    });

    const rendered = await app.render("page", { name: "Ana" });
    assert.equal(rendered.statusCode, 200);
    assert.equal(rendered.payload, "<article><p>Ana</p></article>");
});

test("global mode shares namespaced partials across registrations", async (t) => {
    const root = await createTempDir(t);
    const viewsA = path.join(root, "views-a");
    const viewsB = path.join(root, "views-b");
    const partialsA = path.join(root, "partials-a");
    const partialsB = path.join(root, "partials-b");

    await writeTemplate(viewsA, "page.sqrl", "{{@include('shared-global/widget', { word: it.word })/}}");
    await writeTemplate(viewsB, "page.sqrl", "{{@include('shared-global/widget', { word: it.word })/}}");
    await writeTemplate(partialsA, "widget.sqrl", "A:{{it.word}}");
    await writeTemplate(partialsB, "widget.sqrl", "B:{{it.word}}");

    const appA = createFastifyHarness();
    await appA.register({
        templates: viewsA,
        partials: partialsA,
        partialsNamespace: "shared-global",
    });

    const appB = createFastifyHarness();
    await appB.register({
        templates: viewsB,
        partials: partialsB,
        partialsNamespace: "shared-global",
    });

    const fromA = await appA.render("page", { word: "one" });
    const fromB = await appB.render("page", { word: "two" });
    assert.equal(fromA.payload, "B:one");
    assert.equal(fromB.payload, "B:two");
});

test("scoped mode isolates namespaced partials per registration", async (t) => {
    const root = await createTempDir(t);
    const viewsA = path.join(root, "views-a");
    const viewsB = path.join(root, "views-b");
    const partialsA = path.join(root, "partials-a");
    const partialsB = path.join(root, "partials-b");

    await writeTemplate(viewsA, "page.sqrl", "{{@include('shared-scoped/widget', { word: it.word })/}}");
    await writeTemplate(viewsB, "page.sqrl", "{{@include('shared-scoped/widget', { word: it.word })/}}");
    await writeTemplate(partialsA, "widget.sqrl", "A:{{it.word}}");
    await writeTemplate(partialsB, "widget.sqrl", "B:{{it.word}}");

    const appA = createFastifyHarness();
    await appA.register({
        templates: viewsA,
        partials: partialsA,
        partialsNamespace: "shared-scoped",
        sqrl: { scope: "scoped" },
    });

    const appB = createFastifyHarness();
    await appB.register({
        templates: viewsB,
        partials: partialsB,
        partialsNamespace: "shared-scoped",
        sqrl: { scope: "scoped" },
    });

    const fromA = await appA.render("page", { word: "one" });
    const fromB = await appB.render("page", { word: "two" });
    assert.equal(fromA.payload, "A:one");
    assert.equal(fromB.payload, "B:two");
});
