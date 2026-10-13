// 1단계: 질문과 비슷한 청크를 찾아 보여 준다
// 실행: node src/search.mjs "질문1" ["질문2" …] [--k 3] [--hybrid]
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { embedQuery, MODEL, DTYPE } from "./embedder.mjs";

// 약한 근거 기준은 이 파일에서만 정의한다
export const WEAK_THRESHOLD = 0.55;
const DEFAULT_K = 3;
const VECTORS_PATH = new URL("../data/vectors.json", import.meta.url);
const BAR_WIDTH = 20;
const PREVIEW_LENGTH = 60;

// --hybrid: 코사인 상위 10개 + 겹치지 않는 BM25 상위 5개
const HYBRID_VECTOR_K = 10;
const HYBRID_BM25_K = 5;
const BM25_K1 = 1.5;
const BM25_B = 0.75;
// 띄어쓰기로 떨어져 나오는 흔한 조사·의문사·요청어
const STOPWORDS = new Set([
  "에서", "으로", "에게", "한테", "까지", "부터", "이랑", "하고", "그리고",
  "어떻게", "어떤", "무엇", "뭐야", "뭐예요", "뭔가요", "얼마나", "언제", "어디",
  "어때", "어때요", "알려", "알려줘", "알려주세요", "해줘", "해주세요",
  "하나요", "인가요", "있어", "있어요", "있나요", "해요", "하면", "해야",
]);

// 벡터 저장소는 한 번만 읽어 재사용한다
let storePromise = null;

async function readStore() {
  const store = JSON.parse(await readFile(VECTORS_PATH, "utf-8"));
  if (store.model !== MODEL || store.dtype !== DTYPE) {
    throw new Error(
      `벡터 저장소(${store.model}, ${store.dtype})가 현재 embedder(${MODEL}, ${DTYPE})와 다릅니다.\n` +
        "node src/build-index.mjs 를 다시 실행하세요.",
    );
  }
  return store;
}

function loadStore() {
  if (!storePromise) {
    storePromise = readStore().catch((error) => {
      storePromise = null;
      throw error;
    });
  }
  return storePromise;
}

// 벡터가 정규화되어 있으므로 내적이 곧 코사인 유사도다
function dot(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

function rankByVector(chunks, queryVector) {
  return chunks
    .map(({ id, text, url, section, vector }) => ({ id, text, url, section, score: dot(queryVector, vector) }))
    .sort((a, b) => b.score - a.score);
}

export async function search(question, k = DEFAULT_K) {
  const store = await loadStore();
  const queryVector = await embedQuery(question);
  return rankByVector(store.chunks, queryVector).slice(0, k);
}

// 소문자화 → 한글·영문·숫자 외 문자로 분리 → 2글자 미만·불용어 제거
export function tokenize(text) {
  return text
    .toLowerCase()
    .split(/[^가-힣a-z0-9]+/)
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));
}

// tf는 "문서 토큰이 검색어를 포함하는 횟수"로 센다 (조사가 붙은 '재고는'도 '재고'로 잡힌다)
function bm25Scores(queryTerms, docsTokens) {
  const docCount = docsTokens.length;
  const avgLength = docsTokens.reduce((sum, tokens) => sum + tokens.length, 0) / docCount;
  const terms = [...new Set(queryTerms)];
  const tfTable = terms.map((term) => docsTokens.map((tokens) => tokens.filter((t) => t.includes(term)).length));

  return docsTokens.map((tokens, docIndex) =>
    terms.reduce((sum, _term, termIndex) => {
      const tf = tfTable[termIndex][docIndex];
      if (tf === 0) return sum;
      const df = tfTable[termIndex].filter((count) => count > 0).length;
      const idf = Math.log(1 + (docCount - df + 0.5) / (df + 0.5));
      const lengthNorm = 1 - BM25_B + (BM25_B * tokens.length) / avgLength;
      return sum + (idf * tf * (BM25_K1 + 1)) / (tf + BM25_K1 * lengthNorm);
    }, 0),
  );
}

export async function hybridSearch(question) {
  const store = await loadStore();
  const queryVector = await embedQuery(question);
  const vectorTop = rankByVector(store.chunks, queryVector)
    .slice(0, HYBRID_VECTOR_K)
    .map((result) => ({ ...result, source: "vector" }));

  const raw = bm25Scores(
    tokenize(question),
    store.chunks.map((chunk) => tokenize(chunk.section + " " + chunk.text)),
  );
  // 전체 청크의 BM25 최고점으로 나눠 0~1로 맞춘다
  const maxRaw = Math.max(...raw);
  const taken = new Set(vectorTop.map((result) => result.id));
  const bm25Top = store.chunks
    .map(({ id, text, url, section }, index) => ({
      id, text, url, section, source: "bm25", rawScore: raw[index], score: maxRaw > 0 ? raw[index] / maxRaw : 0,
    }))
    .filter((result) => result.rawScore > 0 && !taken.has(result.id))
    .sort((a, b) => b.score - a.score)
    .slice(0, HYBRID_BM25_K);

  return [...vectorTop, ...bm25Top];
}

function scoreBar(score) {
  const filled = Math.round(Math.min(Math.max(score, 0), 1) * BAR_WIDTH);
  return "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
}

function preview(text) {
  return text.length > PREVIEW_LENGTH ? text.slice(0, PREVIEW_LENGTH) + "…" : text;
}

function parseArgs(argv) {
  const questions = [];
  let k = DEFAULT_K;
  let hybrid = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--k") {
      k = Number(argv[++i]);
      if (!Number.isInteger(k) || k < 1) throw new Error("--k 뒤에는 1 이상의 정수를 넣으세요.");
    } else if (argv[i] === "--hybrid") {
      hybrid = true;
    } else {
      questions.push(argv[i]);
    }
  }
  if (questions.length === 0) throw new Error('사용법: node src/search.mjs "질문1" ["질문2" …] [--k 3] [--hybrid]');
  return { questions, k, hybrid };
}

// 약함 판정은 하이브리드에서도 코사인 1위(첫 결과) 기준이다
function printResults(question, results) {
  const weak = results.length === 0 || results[0].score < WEAK_THRESHOLD;
  console.log(`Q: ${question}${weak ? `  ⚠ 관련 자료가 약함(<${WEAK_THRESHOLD})` : ""}`);
  results.forEach((r, index) => {
    const tag = r.source ? `[${r.source}] ` : "";
    console.log(`  ${index + 1}. ${r.id}  ${r.score.toFixed(3)}  ${scoreBar(r.score)}  ${tag}[${r.section}]`);
    console.log(`     ${preview(r.text)}`);
    console.log(`     출처: ${r.url}`);
  });
  console.log();
}

async function main() {
  const { questions, k, hybrid } = parseArgs(process.argv.slice(2));
  await loadStore(); // 모델을 불러오기 전에 저장소부터 검사한다
  if (hybrid && k !== DEFAULT_K) {
    console.warn(`--hybrid에서는 --k를 쓰지 않습니다 (코사인 ${HYBRID_VECTOR_K}개 + BM25 최대 ${HYBRID_BM25_K}개).`);
  }
  for (const question of questions) {
    printResults(question, hybrid ? await hybridSearch(question) : await search(question, k));
  }
}

// 다른 파일이 import할 때는 CLI를 돌지 않는다
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`✗ ${error.message}`);
    process.exitCode = 1;
  });
}
