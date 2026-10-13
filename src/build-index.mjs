// data/chunks.json을 임베딩해서 data/vectors.json으로 저장한다
// 실행: node src/build-index.mjs
import { readFile, writeFile } from "node:fs/promises";
import { embedDocument, MODEL, DTYPE, DIM } from "./embedder.mjs";

const CHUNKS_PATH = new URL("../data/chunks.json", import.meta.url);
const VECTORS_PATH = new URL("../data/vectors.json", import.meta.url);
const REQUIRED_FIELDS = ["id", "text", "url", "section"];
const MIN_TEXT_LENGTH = 120;

// 필드 누락·중복 id는 중단, 짧은 text는 경고만 한다
function validateChunks(chunks) {
  if (!Array.isArray(chunks)) {
    throw new Error("data/chunks.json은 배열이어야 합니다.");
  }

  const errors = [];
  const seenIds = new Set();

  chunks.forEach((chunk, index) => {
    const label = chunk?.id ?? `${index + 1}번째 항목`;
    const missing = REQUIRED_FIELDS.filter(
      (field) => typeof chunk?.[field] !== "string" || chunk[field].trim() === "",
    );
    if (missing.length > 0) {
      errors.push(`${label}: 필드 누락 (${missing.join(", ")})`);
    }
    if (typeof chunk?.id === "string") {
      if (seenIds.has(chunk.id)) {
        errors.push(`${chunk.id}: 중복 id`);
      }
      seenIds.add(chunk.id);
    }
    if (typeof chunk?.text === "string" && chunk.text.length < MIN_TEXT_LENGTH) {
      console.warn(`⚠ ${label}: text가 ${chunk.text.length}자로 ${MIN_TEXT_LENGTH}자 미만`);
    }
  });

  if (errors.length > 0) {
    throw new Error(`청크 검사 실패:\n- ${errors.join("\n- ")}`);
  }
}

function vectorNorm(vector) {
  return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
}

async function main() {
  const chunks = JSON.parse(await readFile(CHUNKS_PATH, "utf-8"));
  validateChunks(chunks);

  const embedded = [];
  for (const chunk of chunks) {
    const vector = await embedDocument(chunk);
    embedded.push({ id: chunk.id, text: chunk.text, url: chunk.url, section: chunk.section, vector });
    console.log(`✓ ${chunk.id} (${chunk.section})`);
  }

  const wrongDim = embedded.filter((chunk) => chunk.vector.length !== DIM);
  if (wrongDim.length > 0) {
    const detail = wrongDim.map((chunk) => `${chunk.id}: ${chunk.vector.length}차원`).join(", ");
    throw new Error(`${DIM}차원이 아닌 벡터가 있습니다 — ${detail}`);
  }

  const store = { model: MODEL, dtype: DTYPE, dim: DIM, createdAt: new Date().toISOString(), chunks: embedded };
  await writeFile(VECTORS_PATH, JSON.stringify(store, null, 2) + "\n", "utf-8");
  console.log(`저장: data/vectors.json — ${embedded.length}청크 × ${DIM}차원`);

  // 학습용: 첫 청크 벡터 들여다보기
  const first = embedded[0];
  console.log(`\n[학습용] ${first.id} 벡터 앞 5개: [${first.vector.slice(0, 5).map((v) => v.toFixed(6)).join(", ")}]`);
  console.log(`[학습용] ${first.id} 벡터 길이(노름): ${vectorNorm(first.vector).toFixed(6)} (1.0이어야 함)`);
}

main().catch((error) => {
  console.error(`✗ ${error.message}`);
  process.exitCode = 1;
});
