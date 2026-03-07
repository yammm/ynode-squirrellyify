import Fastify from "fastify";
import path from "node:path";
import process from "node:process";
import squirrellyify from "../src/plugin.js";

const app = Fastify({ logger: true });

// Register the Squirrelly Fastify Plugin to enable full-featured HTML rendering
await app.register(squirrellyify, {
    templates: path.join(process.cwd(), "example/views"),
    layout: "main",
    cache: false,
});

app.get("/", async function (request, reply) {
    // Render the `index.sqrl` template nested within `example/views/`
    return reply.view("index", {
        title: "@ynode/squirrellyify Demo",
        message: "Hello from Squirrelly templates!"
    });
});

try {
    await app.listen({ port: 3000 });
    console.log("Server listening at http://localhost:3000");
} catch (err) {
    app.log.error(err);
    process.exit(1);
}
