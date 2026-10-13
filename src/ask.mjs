// 2단계: 찾은 자료를 질문과 함께 LLM에 넣어 답을 받는다
// 실행: node src/ask.mjs "질문" [--show-prompt]
// 첫 버전: --show-prompt로 조립된 메시지만 출력한다 (아직 LLM 호출 없음)
import { search } from "./search.mjs";
import { SYSTEM_MESSAGE, buildPrompt } from "./prompt.mjs";

const TOP_K = 3;

function parseArgs(argv) {
  const showPrompt = argv.includes("--show-prompt");
  const questions = argv.filter((arg) => arg !== "--show-prompt");
  if (questions.length !== 1) throw new Error('사용법: node src/ask.mjs "질문" [--show-prompt]');
  return { question: questions[0], showPrompt };
}

async function main() {
  const { question, showPrompt } = parseArgs(process.argv.slice(2));
  if (!showPrompt) {
    throw new Error("아직 LLM 호출은 만들지 않았습니다. --show-prompt를 붙여 실행하세요.");
  }

  const hits = await search(question, TOP_K);
  console.log("===== system =====");
  console.log(SYSTEM_MESSAGE);
  console.log("\n===== user =====");
  console.log(buildPrompt(question, hits));
}

main().catch((error) => {
  console.error(`✗ ${error.message}`);
  process.exitCode = 1;
});
