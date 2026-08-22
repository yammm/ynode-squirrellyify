import type { FastifyPluginAsync } from "fastify";

type SqrlModule = typeof import("squirrelly");

/** A custom Squirrelly helper callback. */
export type SqrlHelper = Parameters<SqrlModule["helpers"]["define"]>[1];

/** A custom Squirrelly filter callback. */
export type SqrlFilter = Parameters<SqrlModule["filters"]["define"]>[1];

/** A compiled Squirrelly template callback. */
export type SqrlTemplate = Parameters<SqrlModule["templates"]["define"]>[1];

export type ClientTemplateInput =
    string | { source: string; file?: never } | { file: string; source?: never };

export interface ClientCompileConfig extends Record<string, unknown> {
    /** Make every generated renderer return `Promise<string>`. @default false */
    async?: boolean;
}

export interface CompileClientModuleOptions {
    /** Named templates exposed as properties on the generated `render` object. */
    templates: Record<string, ClientTemplateInput>;

    /** Pure, browser-safe custom Squirrelly helpers. Async helpers require `config.async`. */
    helpers?: Record<string, SqrlHelper>;

    /** Pure, browser-safe custom Squirrelly filters. Async filters require `config.async`. */
    filters?: Record<string, SqrlFilter>;

    /** Supported Squirrelly compile configuration overrides, including explicit async mode. */
    config?: ClientCompileConfig;
}

/** Compile named Squirrelly templates into one self-contained browser ES module. */
export function compileClientModule(options: CompileClientModuleOptions): Promise<string>;

export interface BuildClientModuleInput extends CompileClientModuleOptions {
    /** Process- or build-config-relative generated ES module path. */
    output: string;

    /** Emit a generated declaration beside the module or at a custom path. @default true */
    declaration?: boolean | string;

    /** Emit a template source map beside the module or at a custom path. @default true */
    sourceMap?: boolean | string;
}

export interface BuildClientModulesOptions {
    /** Named client modules to compile and write. */
    modules: Record<string, BuildClientModuleInput>;

    /** Base directory for relative template and output paths. */
    cwd?: string;

    /** Verify generated artifacts without writing and reject when any are stale. @default false */
    check?: boolean;
}

export interface BuiltClientModule {
    name: string;
    output: string;
    bytes: number;
    declaration?: string;
    declarationBytes?: number;
    sourceMap?: string;
    sourceMapBytes?: number;
    /** Whether this build invocation replaced at least one artifact for the module. */
    written: boolean;
}

/** Compile and write static client render modules using per-file atomic replacement. */
export function buildClientModules(
    options: BuildClientModulesOptions,
): Promise<BuiltClientModule[]>;

export interface SqrlEngineOptions {
    /**
     * Whether to share helpers/filters/partials globally or isolate them per Fastify registration.
     * @default "global"
     */
    scope?: "global" | "scoped";

    /** Squirrelly compile/render configuration overrides. */
    config?: Record<string, unknown>;

    /** Custom Squirrelly helpers keyed by name. */
    helpers?: Record<string, SqrlHelper>;

    /** Custom Squirrelly filters keyed by name. */
    filters?: Record<string, SqrlFilter>;
}

export interface PartialsDirEntry {
    /** Directory where partial templates are stored. */
    dir: string;

    /**
     * Namespace prefix for this directory's partial names, overriding the
     * registration-wide `partialsNamespace` option. Use `true` to prefix with
     * the directory basename, a string for a custom prefix, or `false` for
     * bare names.
     */
    namespace?: boolean | string;
}

export interface SquirrellyifyOptions {
    /**
     * Directory or directories where page and layout templates are stored.
     * Directories are searched in order.
     * @default "./views"
     */
    templates?: string | string[];

    /**
     * Directory or directories where partial templates are stored. Array
     * entries may be `{ dir, namespace }` objects to namespace one directory
     * independently of the others.
     */
    partials?: string | Array<string | PartialsDirEntry>;

    /**
     * Enable recursive loading of partial templates from subdirectories.
     * @default true
     */
    partialsRecursive?: boolean;

    /**
     * Optional namespace prefix for partial names. Use `true` to namespace
     * by partials directory basename, or a string for a custom prefix.
     * Entries with their own `namespace` override this per directory.
     * @default false
     */
    partialsNamespace?: boolean | string;

    /**
     * Name of the default layout file (without extension).
     */
    layout?: string;

    /**
     * Default file extension for template files.
     * @default "sqrl"
     */
    defaultExtension?: string;

    /**
     * Enable template caching.
     * @default process.env.NODE_ENV === "production"
     */
    cache?: boolean;

    /**
     * Squirrelly engine options.
     */
    sqrl?: SqrlEngineOptions;
}

export interface ViewCacheControl {
    /** Clear all template, path, and metadata caches. */
    clear(): void;
    /** Return cache enablement and per-cache entry counts. */
    stats(): { enabled: boolean; templates: number; paths: number; metadata: number };
}

/**
 * Data exposed to a rendered page. `layout` and `layoutData` are reserved
 * rendering controls; do not populate this object by spreading untrusted input.
 */
export interface ViewData extends Record<string, unknown> {
    /** Select a layout for this render, or disable layouts with false. */
    layout?: string | false;

    /** Values visible only while rendering the selected layout. */
    layoutData?: Record<string, unknown>;
}

export interface ViewStoreApi<DefineValue = SqrlHelper, StoredValue = DefineValue> {
    define(name: string, value: DefineValue): void;
    get(name: string): StoredValue | undefined;
    remove(name: string): void;
}

declare module "fastify" {
    interface FastifyInstance {
        /** The Squirrelly engine instance for advanced configuration. */
        Sqrl: typeof import("squirrelly");

        /** Override template search directories for this Fastify scope. */
        views: string | string[] | null;

        /** Override the default layout for this Fastify scope. */
        layout: string | null;

        /** Runtime helper management API. */
        viewHelpers: ViewStoreApi<SqrlHelper>;

        /** Runtime filter management API. */
        viewFilters: ViewStoreApi<SqrlFilter>;

        /** Runtime partial/template management API. */
        viewPartials: ViewStoreApi<string | SqrlTemplate, SqrlTemplate>;

        /** Template cache management. */
        viewCache: ViewCacheControl;
    }

    interface FastifyReply {
        /** Per-request context data merged into template scope. */
        context: Record<string, unknown>;

        /**
         * Render a Squirrelly template and send it as an HTML response.
         * @param template - Template name (without extension).
         * @param data - Data to pass to the template. Set `layout: false` to
         * disable layout, or `layout: "name"` to select one for this request.
         * A `layoutData` object supplies layout-only data merged over the page
         * data when the layout itself renders.
         */
        view(template: string, data?: ViewData): Promise<void>;
    }
}

export const squirrellyify: FastifyPluginAsync<SquirrellyifyOptions>;
export default squirrellyify;
