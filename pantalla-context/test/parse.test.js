import assert from "node:assert/strict";
import { test } from "node:test";
import { parseModelJson } from "../src/parse.js";

test("JSON limpio, con vallas de código o con texto alrededor", () => {
  assert.deepEqual(parseModelJson('{"a":1}'), { a: 1 });
  assert.deepEqual(parseModelJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseModelJson('```\n{"a":{"b":[1,2]}}\n```'), { a: { b: [1, 2] } });
  assert.deepEqual(parseModelJson('Aquí tienes: {"a":"x}y"} ¡suerte!'), { a: "x}y" });
});

test("devuelve null si no hay un objeto JSON utilizable", () => {
  for (const text of ["", "hola", "[1,2]", "42", '"texto"', "{roto", null, undefined, "null"]) {
    assert.equal(parseModelJson(text), null, String(text));
  }
});
