#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { buildClientModules } from "./client-module.js";

const usage = "Usage: squirrellyify-client [--check] [--debug] [--] <config-file>";
const USAGE_EXIT_STATUS = 2;

class UsageError extends TypeError {}

function packageVersion() {
    const packagePath = new URL("../package.json", import.meta.url);
    return JSON.parse(fs.readFileSync(packagePath, "utf8")).version;
}

function parseArguments(arguments_) {
    let check = false;
    let debug = false;
    let optionsEnabled = true;
    const positionalArguments = [];

    for (const argument of arguments_) {
        if (optionsEnabled && argument === "--") {
            optionsEnabled = false;
            continue;
        }
        if (!optionsEnabled || !argument.startsWith("-")) {
            positionalArguments.push(argument);
            continue;
        }
        if (argument === "--help" || argument === "-h") {
            return { action: "help", check, debug };
        }
        if (argument === "--version" || argument === "-v") {
            return { action: "version", check, debug };
        }
        if (argument === "--check") {
            if (check) {
                throw new UsageError("--check may be specified only once");
            }
            check = true;
            continue;
        }
        if (argument === "--debug") {
            debug = true;
            continue;
        }
        throw new UsageError(`Unknown option: ${argument}`);
    }

    if (positionalArguments.length !== 1) {
        throw new UsageError("Exactly one config file is required");
    }
    return { action: "build", check, configArgument: positionalArguments[0], debug };
}

function debugRequested(arguments_) {
    const endOfOptions = arguments_.indexOf("--");
    const options = endOfOptions === -1 ? arguments_ : arguments_.slice(0, endOfOptions);
    return options.includes("--debug");
}

async function main() {
    const arguments_ = process.argv.slice(2);
    const parsed = parseArguments(arguments_);
    if (parsed.action === "help") {
        process.stdout.write(`${usage}\n`);
        return;
    }
    if (parsed.action === "version") {
        process.stdout.write(`${packageVersion()}\n`);
        return;
    }

    const configPath = path.resolve(parsed.configArgument);
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

    const checkMode = parsed.check ? true : config.check;
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
    const arguments_ = process.argv.slice(2);
    const debug = debugRequested(arguments_);
    const detail = debug ? (error?.stack ?? error) : (error?.message ?? error);
    process.stderr.write(`${detail}\n`);
    if (error instanceof UsageError) {
        process.stderr.write(`${usage}\n`);
        process.exitCode = USAGE_EXIT_STATUS;
        return;
    }
    process.exitCode = 1;
});
