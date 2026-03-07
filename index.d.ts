import { FastifyPluginAsync } from "fastify";

export interface SquirrellyifyOptions {
    /**
     * Enable caching of templates.
     * @default process.env.NODE_ENV === 'production'
     */
    cache?: boolean;
    /**
     * Path to the views directory.
     * @default './views'
     */
    views?: string;
    /**
     * Squirrelly specific configuration options overriden.
     */
    options?: Record<string, any>;
}

export const squirrellyify: FastifyPluginAsync<SquirrellyifyOptions>;
export default squirrellyify;
