import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const INPUT = resolve(import.meta.dirname!, "../data/86-posts-ingest-ready.json");
const DATA_WORKER = "https://gaia-data.sumanta-7a8.workers.dev";

interface IngestPayload {
  data: Record<string, string | number>;
  key_keys: string[];
  source: string;
  postid: string;
}

async function ingestOne(payload: IngestPayload): Promise<{ ok: boolean; result: string }> {
  const body = {
    data: payload.data,
    key_keys: payload.key_keys,
    source: payload.source,
    id: payload.postid, // API accepts id as alternative to slug
  };

  try {
    const resp = await fetch(`${DATA_WORKER}/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const text = await resp.text();
    if (resp.ok) {
      const j = JSON.parse(text);
      return { ok: true, result: `id=${j.id} canonicalized=${(j.canonical_text?.length ?? 0)} chars` };
    }
    return { ok: false, result: `HTTP ${resp.status}: ${text.slice(0, 200)}` };
  } catch (e) {
    return { ok: false, result: String(e).slice(0, 200) };
  }
}

const payloads = JSON.parse(readFileSync(INPUT, "utf-8")) as IngestPayload[];

console.log(`Sending ${payloads.length} posts to ${DATA_WORKER}/ingest...\n`);

let ok = 0;
let fail = 0;

for (let i = 0; i < payloads.length; i++) {
  const { postid } = payloads[i];
  const { ok: success, result } = await ingestOne(payloads[i]);

  if (success) {
    ok++;
    console.log(`[${i + 1}/${payloads.length}] OK  postid=${postid}  ${result}`);
  } else {
    fail++;
    console.log(`[${i + 1}/${payloads.length}] FAIL postid=${postid}  ${result}`);
  }

  // Small delay to avoid hammering the worker
  if (i < payloads.length - 1) {
    await new Promise((r) => setTimeout(r, 500));
  }
}

console.log(`\nDone. ${ok} OK, ${fail} failed, ${payloads.length} total.`);
