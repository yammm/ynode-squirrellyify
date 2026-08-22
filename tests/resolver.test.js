import assert from "node:assert/strict";
import test from "node:test";

import { detectLayoutTag } from "../src/resolver.js";

test("detectLayoutTag recognizes every layout-managing tag variant", () => {
    const layoutManagingSources = [
        '{{!layout("base")}}<p>body</p>',
        '{{! layout("base") }}<p>body</p>',
        '{{ ! layout("base") }}<p>body</p>',
        '{{!\n    layout("base")\n}}<p>body</p>',
        '{{@extends("base")}}<p>body</p>{{/extends}}',
        '{{@ extends("base") }}<p>body</p>{{/ extends }}',
        '{{-@ extends("base") }}<p>body</p>{{/ extends }}',
        '{{_@ extends("base") }}<p>body</p>{{/ extends }}',
        '{{-! layout("base") }}<p>body</p>',
        '{{_!layout("base")}}<p>body</p>',
    ];

    for (const source of layoutManagingSources) {
        assert.equal(detectLayoutTag(source), true, `expected layout tag in: ${source}`);
    }
});

test("detectLayoutTag ignores templates without a layout tag", () => {
    const plainSources = [
        "<p>{{ it.name }}</p>",
        "{{ layout }}",
        "{{ it.layout }}",
        '{{!layoutify("base")}}',
        '{{@extendsish("base")}}{{/extendsish}}',
        "layout( is discussed in prose, not in a tag",
    ];

    for (const source of plainSources) {
        assert.equal(detectLayoutTag(source), false, `expected no layout tag in: ${source}`);
    }
});
