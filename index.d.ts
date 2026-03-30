import type { FastifyPluginAsync } from "fastify";

export interface SqrlEngineOptions {
    /**
     * Whether to share helpers/filters/partials globally or isolate them per Fastify registration.
     * @default "global"
     */
    scope?: "global" | "scoped";

    /** Squirrelly compile/render configuration overrides. */
    config?: Record<string, unknown>;

    /** Custom Squirrelly helpers keyed by name. */
    helpers?: Record<string, (...args: unknown[]) => unknown>;

    /** Custom Squirrelly filters keyed by name. */
    filters?: Record<string, (...args: unknown[]) => unknown>;
}

export interface SquirrellyifyOptions {
    /**
     * Directory or directories where page and layout templates are stored.
     * Directories are searched in order.
     * @default "./views"
     */
    templates?: string | string[];

    /**
     * Directory or directories where partial templates are stored.
     */
    partials?: string | string[];

    /**
     * Enable recursive loading of partial templates from subdirectories.
     * @default true
     */
    partialsRecursive?: boolean;

    /**
     * Optional namespace prefix for partial names. Use `true` to namespace
     * by partials directory basename, or a string for a custom prefix.
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
    /** Return cache hit counts and sizes. */
    stats(): { enabled: boolean; templates: number; paths: number; metadata: number };
}

export interface ViewStoreApi<T = (...args: unknown[]) => unknown> {
    define(name: string, value: T): void;
    get(name: string): T | undefined;
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
        viewHelpers: ViewStoreApi;

        /** Runtime filter management API. */
        viewFilters: ViewStoreApi;

        /** Runtime partial/template management API. */
        viewPartials: ViewStoreApi;

        /** Template cache management. */
        viewCache: ViewCacheControl;
    }

    interface FastifyReply {
        /** Per-request context data merged into template scope. */
        context: Record<string, unknown>;

        /**
         * Render a Squirrelly template and send it as an HTML response.
         * @param template - Template name (without extension).
         * @param data - Data to pass to the template. Set `layout: false` to disable layout.
         */
        view(template: string, data?: Record<string, unknown>): Promise<void>;
    }
}

export const squirrellyify: FastifyPluginAsync<SquirrellyifyOptions>;
export default squirrellyify;
