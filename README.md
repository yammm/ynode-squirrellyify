# @ynode/squirrellyify

Copyright (c) 2025 Michael Welter <me@mikinho.com>

[![npm version](https://img.shields.io/npm/v/@ynode/squirrellyify.svg)](https://www.npmjs.com/package/@ynode/squirrellyify)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A simple and fast plugin for using the [Squirrelly](https://squirrelly.js.org/) template engine with
[Fastify](https://www.fastify.io/).

## Features

- 🐿️ **Modern Templating:** Full support for Squirrelly v9 features.
- ⚡ **High Performance:** Template caching is enabled by default in production.
- 📁 **Layouts & Partials:** Built-in support for layouts and shared partials.
- 🧬 **Encapsulation-Aware:** Respects Fastify's encapsulation model for s ed configurations.
- 🛡️ **Secure:** Protects against path traversal attacks in template names.
- 🔧 **Extensible:** Easily add custom Squirrelly helpers and filters.

## Installation

You need to install `squirrelly` and `fastify` alongside this plugin.

```bash
npm install @ynode/squirrellyify squirrelly fastify
```

## Basic Usage

1.  **Register the plugin.**
2.  **Use the `reply.view()` decorator in your routes.**

By default, the plugin looks for templates in a `views` directory in your project's root.

**File structure:**

```text
.
├── views/
│   └── index.sqrl
└── server.js
```

**`views/index.sqrl`**

```html
<h1>Hello, {{ it.name }}!</h1>
```

**`server.js`**

```javascript
import Fastify from "fastify";
import squirrellyify from "@ynode/squirrellyify";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const fastify = Fastify({
    logger: true,
});

fastify.register(squirrellyify, {
    templates: path.join(__dirname, "views"),
});

fastify.get("/", (request, reply) => {
    return reply.view("index", { name: "World" });
});

fastify.listen({ port: 3000 }, (err) => {
    if (err) throw err;
});
```

## Configuration Options

You can pass an options object when registering the plugin.

| Option             | Type                 | Default                             | Description                                                                                                                          |
| ------------------ | -------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `templates`        | `string \| string[]` | `path.join(process.cwd(), "views")` | The directory or directories to search for page and layout templates. Searched in the provided order.                                |
| `partials`         | `string \| string[]` | `[]`                                | The directory or directories for partial templates. All partials are loaded on startup and are available globally by their filename. |
| `layout`           | `string`             | `undefined`                         | The name of the default layout file to use (without extension). Can be overridden per-route.                                         |
| `defaultExtension` | `string`             | `"sqrl"`                            | The file extension for all template files.                                                                                           |
| `cache`            | `boolean`            | `NODE_ENV === "production"`         | If `true`, compiled templates and resolved file paths will be cached in memory.                                                      |
| `sqrl`             | `object`             | `undefined`                         | An object to configure Squirrelly. Currently supports `{ helpers: {}, filters: {} }` for adding custom functions.                    |

## Advanced Usage

### Layouts

Layouts are wrappers for your page templates. The rendered page content is injected into the `body`
variable within the layout.

**`views/layouts/main.sqrl`**

```html
<!DOCTYPE html>
<html lang="en">
    <head>
        <title>{{ it.title }}</title>
    </head>
    <body>
        <header>My Awesome Site</header>
        <main>
            {{@block("content")}} {{@try}} {{it.body | safe}} {{#catch => err}} Uh-oh, error!
            Message was '{{err.message}}' {{/try}} {{/block}}
        </main>
    </body>
</html>
```

**`views/about.sqrl`**

```html
{{@extends("layout", it)}} {{#content}}
<h2>About Us</h2>
<p>This is the about page content.</p>

{{/extends}}
```

You can specify a layout in three ways (in order of precedence):

1.  **In the `reply.view()` data object:**

    ```javascript
    fastify.get("/about", (request, reply) => {
        const pageData = { title: "About Page" };
        // Use `main.sqrl` as the layout for this request
        return reply.view("about", { ...pageData, layout: "layouts/main" });
    });

    // To disable the default layout for a specific route:
    fastify.get("/no-layout", (request, reply) => {
        return reply.view("some-page", { layout: false });
    });
    ```

2.  **As a default plugin option:**

    ```javascript
    fastify.register(squirrellyify, {
        templates: "views",
        layout: "layouts/main", // All views will use this layout by default
    });
    ```

### Partials

Partials are reusable chunks of template code. Create a `partials` directory and place your files
there. They will be automatically registered by their filename.

**`partials/user-card.sqrl`**

```html
<div class="card">
    <h3>{{ it.name }}</h4>
    <p>{{ it.email }}</p>
</div>
```

**`views/index.sqrl`**

```html
<h1>Users</h1>
{{ include('user-card', { name: 'John Doe', email: 'john@example.com' }) /}}
```

**Register the `partials` directory:**

```javascript
fastify.register(squirrellyify, {
    templates: "views",
    partials: "partials",
});
```

### Scoped Configuration (Encapsulation)

This plugin supports Fastify's encapsulation model. You can register it multiple times with
different settings for different route prefixes.

```javascript
import Fastify from "fastify";
import squirrellyify from "@ynode/squirrellyify";
import path from "node:path";

const fastify = Fastify();

// Register with default settings
fastify.register(squirrellyify, {
    templates: path.join(__dirname, "views"),
    layout: "layouts/main",
});

fastify.get("/", (req, reply) => {
    // Renders from ./views/index.sqrl with layouts/main.sqrl
    return reply.view("index", { title: "Homepage" });
});

// Create a separate scope for an "admin" section
fastify.register(
    (instance, opts, done) => {
        // Override the templates directory and layout for this scope
        instance.views = path.join(__dirname, "admin/views");
        instance.layout = "layouts/admin";

        instance.get("/", (req, reply) => {
            // Renders from ./admin/views/dashboard.sqrl with layouts/admin.sqrl
            return reply.view("dashboard", { title: "Admin Panel" });
        });

        done();
    },
    { prefix: "/admin" },
);
```

### Custom Helpers and Filters

You can extend Squirrelly with custom helper and filter functions via the `sqrl` option.

```javascript
fastify.register(squirrellyify, {
    templates: "views",
    sqrl: {
        helpers: {
            capitalize: (str) => {
                return str.charAt(0).toUpperCase() + str.slice(1);
            },
        },
        filters: {
            truncate: (str, len) => {
                return str.length > len ? str.substring(0, len) + "..." : str;
            },
        },
    },
});
```

## License

This project is licensed under the [MIT Lisence](./LICENSE).
