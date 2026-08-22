#!/usr/bin/env node

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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

async function run(command, args, cwd, env = process.env) {
    await execFileAsync(command, args, {
        cwd,
        env,
        maxBuffer: 10 * 1024 * 1024,
    });
}

async function main() {
    const packageJson = JSON.parse(
        await fs.readFile(path.join(repositoryRoot, "package.json"), "utf-8"),
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
            { cwd: repositoryRoot, env: npmEnvironment, maxBuffer: 10 * 1024 * 1024 },
        );
        const [packed] = JSON.parse(stdout);
        if (!packed?.filename) {
            throw new Error("npm pack did not report a package archive");
        }
        const packedPaths = new Set((packed.files ?? []).map((file) => file.path));
        for (const expectedPath of expectedPackedFiles) {
            if (!packedPaths.has(expectedPath)) {
                throw new Error(`npm pack omitted required file: ${expectedPath}`);
            }
        }

        const archivePath = path.join(packDirectory, packed.filename);
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
            "utf-8",
        );
        await fs.copyFile(
            path.join(repositoryRoot, "tests/types/consumer.ts"),
            path.join(consumerDirectory, "consumer.ts"),
        );
        await fs.copyFile(
            path.join(repositoryRoot, "tests/types/tsconfig.json"),
            path.join(consumerDirectory, "tsconfig.json"),
        );
        for (const file of [
            "default-view-model.d.ts",
            "generate.mjs",
            "generated-consumer.ts",
            "view-models.d.ts",
        ]) {
            await fs.copyFile(
                path.join(repositoryRoot, "tests/types", file),
                path.join(consumerDirectory, file),
            );
        }

        await run(
            npmCommand,
            [
                "install",
                "--ignore-scripts",
                "--no-audit",
                "--no-fund",
                "--no-package-lock",
                "--prefer-offline",
                "--loglevel=error",
            ],
            consumerDirectory,
            npmEnvironment,
        );
        await run(process.execPath, ["generate.mjs"], consumerDirectory, npmEnvironment);
        await run(
            process.execPath,
            [
                path.join(repositoryRoot, "node_modules/typescript/bin/tsc"),
                "--project",
                "tsconfig.json",
            ],
            consumerDirectory,
        );

        process.stdout.write(`TypeScript consumer check passed for ${packageJson.name}.\n`);
    } finally {
        await fs.rm(temporaryRoot, { recursive: true, force: true });
    }
}

await main();
