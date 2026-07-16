#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";

import { buildClientModules } from "./client-module.js";

const usage = "Usage: squirrellyify-client <config-file>";

async function main() {
    const [configArgument, ...extraArguments] = process.argv.slice(2);
    if (configArgument === "--help" || configArgument === "-h") {
        console.log(usage);
        return;
    }
    if (!configArgument || extraArguments.length > 0) {
        throw new TypeError(usage);
    }

    const configPath = path.resolve(configArgument);
    const imported = await import(pathToFileURL(configPath).href);
    const config = imported.default ?? imported.clientModules;
    if (config === undefined) {
        throw new TypeError(
            `Client module config must export default or a named "clientModules" value: ${configPath}`,
        );
    }
    if (config === null || typeof config !== "object" || Array.isArray(config)) {
        throw new TypeError(`Client module config must export a plain object: ${configPath}`);
    }

    const built = await buildClientModules({
        ...config,
        cwd: config.cwd ?? path.dirname(configPath),
    });
    for (const module of built) {
        console.log(`Built ${module.name}: ${module.output} (${module.bytes} bytes)`);
    }
}

main().catch((error) => {
    console.error(error?.stack ?? error);
    process.exitCode = 1;
});
