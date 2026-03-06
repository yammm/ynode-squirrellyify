#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import process from "node:process";

try {
    const stagedOutput = execFileSync(
        "git",
        ["diff", "--cached", "--name-only", "--diff-filter=ACMRTUXB", "-z"],
        { encoding: "utf8" },
    );
    const files = stagedOutput.split("\0").filter(Boolean);

    if (files.length === 0) {
        process.exit(0);
    }

    execFileSync("npx", ["eslint", "--no-warn-ignored", ...files], { stdio: "inherit" });
} catch (error) {
    if (error?.stdout) {
        process.stdout.write(error.stdout);
    }
    if (error?.stderr) {
        process.stderr.write(error.stderr);
    }
    process.exit(typeof error?.status === "number" ? error.status : 1);
}
