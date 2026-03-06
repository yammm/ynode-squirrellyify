import path from "node:path";

import Sqrl from "squirrelly";

export function resolveInitialTemplateDirs(options = {}) {
    return Array.isArray(options.templates)
        ? options.templates
        : typeof options.templates === "string"
          ? [options.templates]
          : [path.join(process.cwd(), "views")];
}

export function resolveInitialPartialsDirs(options = {}) {
    return Array.isArray(options.partials)
        ? options.partials
        : typeof options.partials === "string"
          ? [options.partials]
          : [];
}

export function resolveExtension(options = {}) {
    const defaultExtension = options.defaultExtension || "sqrl";
    return {
        defaultExtension,
        extensionWithDot: `.${defaultExtension}`,
    };
}

export function resolveUseCache(options = {}) {
    return options.cache ?? process.env.NODE_ENV === "production";
}

function createScopedSqrlConfig(baseConfig) {
    const Cacher = Sqrl.helpers?.constructor;
    if (typeof Cacher !== "function") {
        throw new Error("Unable to initialize scoped Squirrelly storage.");
    }

    const scopedHelpers = new Cacher({});
    const scopedFilters = new Cacher({});
    const scopedTemplates = new Cacher({});

    for (const helperName of [
        "each",
        "foreach",
        "include",
        "extends",
        "useScope",
        "includeFile",
        "extendsFile",
    ]) {
        const helperFn = Sqrl.helpers.get(helperName);
        if (helperFn) {
            scopedHelpers.define(helperName, helperFn);
        }
    }

    const escapeFilter = Sqrl.filters.get("e");
    if (escapeFilter) {
        scopedFilters.define("e", escapeFilter);
    }

    return Sqrl.getConfig(
        {
            ...baseConfig,
            storage: {
                helpers: scopedHelpers,
                nativeHelpers: Sqrl.nativeHelpers,
                filters: scopedFilters,
                templates: scopedTemplates,
            },
        },
        Sqrl.defaultConfig,
    );
}

export function resolveSqrlConfig(options = {}) {
    const sqrlScope = options.sqrl?.scope === "scoped" ? "scoped" : "global";
    const sqrlConfig =
        sqrlScope === "scoped"
            ? createScopedSqrlConfig(options.sqrl?.config)
            : Sqrl.getConfig(options.sqrl?.config ?? {}, Sqrl.defaultConfig);

    return {
        sqrlScope,
        sqrlConfig,
    };
}
