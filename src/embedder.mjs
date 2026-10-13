// 임베딩 계약(CLAUDE.md)을 정의하는 유일한 곳
import { pipeline } from "@huggingface/transformers";

export const MODEL = "onnx-community/embeddinggemma-300m-ONNX";
export const DTYPE = "q8";
export const DIM = 768;

const DOCUMENT_PREFIX = "title: ";
const QUERY_PREFIX = "task: search result | query: ";

// 파이프라인은 한 번만 만들어 재사용한다
let extractorPromise = null;

function getExtractor() {
  if (!extractorPromise) {
    console.log("임베딩 모델 불러오는 중…(첫 실행은 다운로드)");
    extractorPromise = pipeline("feature-extraction", MODEL, { dtype: DTYPE }).catch((error) => {
      // 실패한 Promise를 계속 들고 있지 않도록 비운다
      extractorPromise = null;
      throw error;
    });
  }
  return extractorPromise;
}

async function embed(input) {
  const extractor = await getExtractor();
  const output = await extractor(input, { pooling: "mean", normalize: true });
  return Array.from(output.data);
}

export function embedDocument(chunk) {
  return embed(DOCUMENT_PREFIX + chunk.section + " | text: " + chunk.text);
}

export function embedQuery(question) {
  return embed(QUERY_PREFIX + question);
}
