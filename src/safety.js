import path from "node:path";

/**
 * Allow nested forward-slash paths (e.g. "admin/dashboard"), but block traversal
 * or absolute paths.
 *
 * @param {string} name
 * @return {void}
 */
export function assertSafeName(name) {
    if (typeof name !== "string" || name.length === 0 || name.includes("\0")) {
        throw new Error(`Illegal template name: ${name}`);
    }
    if (name.includes("\\") || path.posix.isAbsolute(name) || path.win32.isAbsolute(name)) {
        throw new Error(`Illegal template name: ${name}`);
    }
    const normalized = path.posix.normalize(name);
    if (normalized !== name || normalized === "." || normalized === "..") {
        throw new Error(`Illegal template name: ${name}`);
    }
    if (normalized.startsWith("../")) {
        throw new Error(`Illegal template name: ${name}`);
    }
    if (
        name
            .split("/")
            .some((segment) => segment.length === 0 || segment === "." || segment === "..")
    ) {
        throw new Error(`Illegal template name: ${name}`);
    }
}
