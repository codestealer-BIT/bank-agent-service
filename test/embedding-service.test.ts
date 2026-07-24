import assert from "node:assert/strict";
import test from "node:test";
import {
  BGE_M3_DIMENSIONS,
  requestEmbeddings,
  vectorSql,
} from "../src/embedding-service.js";

function vector(value: number): number[] {
  return Array.from({ length: BGE_M3_DIMENSIONS }, () => value);
}

test("BGE-M3 client uses the OpenAI-compatible embeddings endpoint", async () => {
  let requestUrl = "";
  let requestBody: Record<string, unknown> = {};
  const fetchImpl: typeof fetch = async (input, init) => {
    requestUrl = String(input);
    requestBody = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        data: [
          { index: 1, embedding: vector(2) },
          { index: 0, embedding: vector(1) },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  const result = await requestEmbeddings(["first", "second"], {
    baseUrl: "http://embeddings:80/v1",
    model: "BAAI/bge-m3",
    timeoutMs: 1_000,
    fetchImpl,
  });

  assert.equal(requestUrl, "http://embeddings:80/v1/embeddings");
  assert.deepEqual(requestBody, {
    model: "BAAI/bge-m3",
    input: ["first", "second"],
    encoding_format: "float",
  });
  assert.equal(result[0][0], 1);
  assert.equal(result[1][0], 2);
  assert.match(vectorSql(result[0]), /^\[1,1,/);
});

test("BGE-M3 client rejects vectors with the wrong dimension", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(
      JSON.stringify({ data: [{ index: 0, embedding: [1, 2, 3] }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  await assert.rejects(
    requestEmbeddings(["test"], {
      baseUrl: "http://embeddings:80/v1",
      model: "BAAI/bge-m3",
      timeoutMs: 1_000,
      fetchImpl,
    }),
    /invalid dimension/,
  );
});
