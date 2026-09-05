#!/usr/bin/env node

/**
 * Verifies the packed TypeScript consumer surface without network access by
 * default. Pass --latest only in the bounded compatibility workflow.
 */

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const expectedPackedFiles = [
    "CHANGELOG.md",
    "LICENSE",
    "README.md",
    "index.d.ts",
    "package.json",
    "src/client-module-cli.js",
    "src/client-module.js",
    "src/config.js",
    "src/plugin.js",
    "src/resolver.js",
    "src/runtime-api.js",
    "src/safety.js",
];
const typeFixtureFiles = [
    "consumer.ts",
    "tsconfig.json",
    "default-view-model.d.ts",
    "generate.mjs",
    "generated-consumer.ts",
    "view-models.d.ts",
];
const generationScripts = ["generate.mjs"];
const NETWORK_TIMEOUT_MS = 120_000;
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;

async function run(command, arguments_, cwd, env = process.env, timeout) {
    await execFileAsync(command, arguments_, {
        cwd,
        env,
        maxBuffer: MAX_BUFFER_BYTES,
        timeout,
    });
}

async function pathExists(target) {
    try {
        await fs.lstat(target);
        return true;
    } catch (error) {
        if (error?.code === "ENOENT") {
            return false;
        }
        throw error;
    }
}

async function linkDirectoryEntries(source, destination) {
    await fs.mkdir(destination, { recursive: true });
    const entries = await fs.readdir(source, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.name.startsWith(".")) {
            continue;
        }
        const sourcePath = path.join(source, entry.name);
        const destinationPath = path.join(destination, entry.name);
        if (entry.name.startsWith("@")) {
            await linkDirectoryEntries(sourcePath, destinationPath);
            continue;
        }
        if (await pathExists(destinationPath)) {
            continue;
        }
        await fs.symlink(
            sourcePath,
            destinationPath,
            process.platform === "win32" && entry.isDirectory() ? "junction" : undefined,
        );
    }
}

async function materializePackedPackage(packedFiles, consumerDirectory, packageName) {
    const packageDirectory = path.join(
        consumerDirectory,
        "node_modules",
        ...packageName.split("/"),
    );
    for (const { path: packedPath } of packedFiles) {
        const sourcePath = path.join(repositoryRoot, packedPath);
        const destinationPath = path.join(packageDirectory, packedPath);
        await fs.mkdir(path.dirname(destinationPath), { recursive: true });
        await fs.copyFile(sourcePath, destinationPath);
    }
}

async function createConsumerFixtures(consumerDirectory) {
    await fs.writeFile(
        path.join(consumerDirectory, "package.json"),
        `${JSON.stringify({ private: true, type: "module" }, null, 4)}\n`,
        "utf8",
    );
    for (const file of typeFixtureFiles) {
        await fs.copyFile(
            path.join(repositoryRoot, "tests/types", file),
            path.join(consumerDirectory, file),
        );
    }
}

async function installLatestConsumer(consumerDirectory, archivePath, packageJson, npmEnvironment) {
    const consumerPackage = {
        private: true,
        type: "module",
        dependencies: {
            "@types/node": packageJson.devDependencies["@types/node"],
            ...packageJson.peerDependencies,
            [packageJson.name]: pathToFileURL(archivePath).href,
        },
    };
    await fs.writeFile(
        path.join(consumerDirectory, "package.json"),
        `${JSON.stringify(consumerPackage, null, 4)}\n`,
        "utf8",
    );
    await run(
        npmCommand,
        [
            "install",
            "--ignore-scripts",
            "--no-audit",
            "--no-fund",
            "--no-package-lock",
            "--prefer-online",
            "--fetch-retries=1",
            "--fetch-timeout=30000",
            "--loglevel=error",
        ],
        consumerDirectory,
        npmEnvironment,
        NETWORK_TIMEOUT_MS,
    );
}

async function main() {
    const arguments_ = process.argv.slice(2);
    if (arguments_.some((argument) => argument !== "--latest") || arguments_.length > 1) {
        throw new TypeError("Usage: node scripts/check-types.mjs [--latest]");
    }
    const latest = arguments_.includes("--latest");
    const packageJson = JSON.parse(
        await fs.readFile(path.join(repositoryRoot, "package.json"), "utf8"),
    );
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "squirrellyify-types-"));
    const npmEnvironment = {
        ...process.env,
        npm_config_cache: path.join(temporaryRoot, "npm-cache"),
    };

    try {
        const packDirectory = path.join(temporaryRoot, "pack");
        const consumerDirectory = path.join(temporaryRoot, "consumer");
        await fs.mkdir(packDirectory, { recursive: true });
        await fs.mkdir(consumerDirectory, { recursive: true });

        const { stdout } = await execFileAsync(
            npmCommand,
            ["pack", "--ignore-scripts", "--json", "--pack-destination", packDirectory],
            {
                cwd: repositoryRoot,
                env: npmEnvironment,
                maxBuffer: MAX_BUFFER_BYTES,
            },
        );
        const [packed] = JSON.parse(stdout);
        if (!packed?.filename || !Array.isArray(packed.files)) {
            throw new Error("npm pack did not report a package archive and file list");
        }
        const packedPaths = new Set(packed.files.map((file) => file.path));
        for (const expectedPath of expectedPackedFiles) {
            if (!packedPaths.has(expectedPath)) {
                throw new Error(`npm pack omitted required file: ${expectedPath}`);
            }
        }

        const archivePath = path.join(packDirectory, packed.filename);
        await createConsumerFixtures(consumerDirectory);
        if (latest) {
            await installLatestConsumer(
                consumerDirectory,
                archivePath,
                packageJson,
                npmEnvironment,
            );
        } else {
            await materializePackedPackage(packed.files, consumerDirectory, packageJson.name);
            await linkDirectoryEntries(
                path.join(repositoryRoot, "node_modules"),
                path.join(consumerDirectory, "node_modules"),
            );
        }

        for (const script of generationScripts) {
            await run(process.execPath, [script], consumerDirectory, npmEnvironment);
        }
        await run(
            process.execPath,
            [
                path.join(repositoryRoot, "node_modules/typescript/bin/tsc"),
                "--project",
                "tsconfig.json",
            ],
            consumerDirectory,
            npmEnvironment,
        );

        const mode = latest ? "latest-peer" : "offline";
        process.stdout.write(`TypeScript ${mode} consumer check passed for ${packageJson.name}.\n`);
    } finally {
        await fs.rm(temporaryRoot, { recursive: true, force: true });
    }
}

main().catch((error) => {
    const detail =
        error?.stderr?.trim() || error?.stdout?.trim() || error?.message || String(error);
    process.stderr.write(`${detail}\n`);
    process.exitCode = 1;
});
