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
