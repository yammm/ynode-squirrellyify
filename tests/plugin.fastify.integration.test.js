import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import Fastify from "fastify";

import squirrellyify from "../src/plugin.js";

async function createTempDir(t) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "squirrellyify-fastify-test-"));
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

test("fastify inject: renders nested template path with layout", async (t) => {
    const root = await createTempDir(t);
    const viewsDir = path.join(root, "views");
    await writeTemplate(viewsDir, "layouts/main.sqrl", "<main>{{it.body | safe}}</main>");
    await writeTemplate(viewsDir, "pages/home.sqrl", "<h1>Hello {{it.name}}</h1>");

    const app = Fastify();
    t.after(async () => {
        await app.close();
    });

    await app.register(squirrellyify, {
        templates: viewsDir,
        layout: "layouts/main",
    });

    app.get("/", (request, reply) => {
        return reply.view("pages/home", { name: "World" });
    });

    const response = await app.inject({ method: "GET", url: "/" });
    assert.equal(response.statusCode, 200);
    assert.match(response.headers["content-type"] ?? "", /^text\/html/);
    assert.equal(response.payload, "<main><h1>Hello World</h1></main>");
});

test("fastify inject: merges reply locals into view data and keeps explicit data precedence", async (t) => {
    const root = await createTempDir(t);
    const viewsDir = path.join(root, "views");
    await writeTemplate(viewsDir, "layouts/main.sqrl", "<main><h2>{{it.title}}</h2>{{it.body | safe}}</main>");
    await writeTemplate(viewsDir, "pages/home.sqrl", "<h1>{{it.name}}</h1><p>{{it.greeting}}</p>");

    const app = Fastify();
    t.after(async () => {
        await app.close();
    });

    await app.register(squirrellyify, {
        templates: viewsDir,
        layout: "layouts/main",
    });

    app.addHook("preHandler", async (request, reply) => {
        reply.locals = { name: "Local Name", greeting: "Hello from locals", title: "Local Title" };
    });

    app.get("/", (request, reply) => {
        return reply.view("pages/home", { name: "Route Name" });
    });

    const response = await app.inject({ method: "GET", url: "/" });
    assert.equal(response.statusCode, 200);
    assert.match(response.headers["content-type"] ?? "", /^text\/html/);
    assert.equal(response.payload, "<main><h2>Local Title</h2><h1>Route Name</h1><p>Hello from locals</p></main>");
});

test("fastify inject: scoped runtime filters stay isolated across scopes", async (t) => {
    const root = await createTempDir(t);
    const viewsA = path.join(root, "views-a");
    const viewsB = path.join(root, "views-b");
    await writeTemplate(viewsA, "page.sqrl", "{{it.word | scopedRuntime}}");
    await writeTemplate(viewsB, "page.sqrl", "{{it.word | scopedRuntime}}");

    const app = Fastify();
    t.after(async () => {
        await app.close();
    });

    await app.register(async (instance) => {
        await instance.register(squirrellyify, {
            templates: viewsA,
            sqrl: { scope: "scoped" },
        });
        instance.viewFilters.define("scopedRuntime", (value) => {
            return `A:${value}`;
        });
        instance.get("/a", (request, reply) => {
            return reply.view("page", { word: "one" });
        });
    });

    await app.register(async (instance) => {
        await instance.register(squirrellyify, {
            templates: viewsB,
            sqrl: { scope: "scoped" },
        });
        instance.get("/b", (request, reply) => {
            return reply.view("page", { word: "two" });
        });
    });

    const fromA = await app.inject({ method: "GET", url: "/a" });
    const fromB = await app.inject({ method: "GET", url: "/b" });

    assert.equal(fromA.statusCode, 200);
    assert.equal(fromA.payload, "A:one");

    assert.equal(fromB.statusCode, 500);
    assert.match(fromB.payload, /Can't find filter 'scopedRuntime'/);
});
