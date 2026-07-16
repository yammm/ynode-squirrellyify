#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";

import { buildClientModules } from "./client-module.js";

const usage = "Usage: squirrellyify-client [--check] <config-file>";

async function main() {
    const arguments_ = process.argv.slice(2);
    if (arguments_.includes("--help") || arguments_.includes("-h")) {
        console.log(usage);
        return;
    }
    const check = arguments_.includes("--check");
    const positionalArguments = arguments_.filter((argument) => argument !== "--check");
    const [configArgument] = positionalArguments;
    if (!configArgument || positionalArguments.length > 1 || configArgument.startsWith("-")) {
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

    const checkMode = check ? true : config.check;
    const built = await buildClientModules({
        ...config,
        cwd: config.cwd ?? path.dirname(configPath),
        check: checkMode,
    });
    for (const module of built) {
        const status = checkMode ? "Checked" : module.written ? "Built" : "Unchanged";
        console.log(`${status} ${module.name}: ${module.output} (${module.bytes} bytes)`);
    }
}

main().catch((error) => {
    console.error(error?.stack ?? error);
    process.exitCode = 1;
});
