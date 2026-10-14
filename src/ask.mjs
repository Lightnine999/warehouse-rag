// 2단계: 찾은 자료를 질문과 함께 LLM에 넣어 답을 받는다
// 실행: node src/ask.mjs "질문" [--k 3] [--show-prompt] [--no-rag]
//       node src/ask.mjs [--k 3]   ← 질문 없이 실행하면 대화형 모드
import * as readline from "node:readline/promises";
import { search, WEAK_THRESHOLD } from "./search.mjs";
import { SYSTEM_MESSAGE, buildPrompt } from "./prompt.mjs";
import { pingOllama, chatStream } from "./ollama.mjs";

const DEFAULT_K = 3;
const USAGE =
  '사용법: node src/ask.mjs "질문" [--k 3] [--show-prompt] [--no-rag]\n' +
  "       node src/ask.mjs [--k 3]   (대화형 모드)";
const EXIT_WORDS = new Set(["exit", "quit"]);

function parseArgs(argv) {
  const questions = [];
  let k = DEFAULT_K;
  let showPrompt = false;
  let noRag = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--k") {
      k = Number(argv[++i]);
      if (!Number.isInteger(k) || k < 1) throw new Error("--k 뒤에는 1 이상의 정수를 넣으세요.");
    } else if (argv[i] === "--show-prompt") {
      showPrompt = true;
    } else if (argv[i] === "--no-rag") {
      noRag = true;
    } else {
      questions.push(argv[i]);
    }
  }
  // 질문이 없으면 대화형 모드 (대화형에서는 --show-prompt, --no-rag를 쓰지 않는다)
  if (questions.length > 1 || (questions.length === 0 && (showPrompt || noRag))) throw new Error(USAGE);
  return { question: questions[0], k, showPrompt, noRag };
}

function seconds(start) {
  return ((performance.now() - start) / 1000).toFixed(1);
}

function printMessages(messages) {
  for (const { role, content } of messages) {
    console.log(`===== ${role} =====`);
    console.log(content);
    console.log();
  }
}

// LLM을 부르기 직전에만 연결을 확인한다
async function ensureOllama() {
  if (await pingOllama()) return true;
  console.error("✗ Ollama가 실행 중인지 확인하세요 (확인: curl http://localhost:11434/api/tags)");
  process.exitCode = 1;
  return false;
}

async function streamAnswer(messages) {
  console.log("💬 답변");
  const answer = await chatStream(messages, (token) => process.stdout.write(token));
  process.stdout.write("\n\n");
  return answer;
}

function printSearchResults(hits, weak) {
  console.log(`🔎 검색 결과${weak ? `  ⚠ 관련 자료가 약함(<${WEAK_THRESHOLD})` : ""}`);
  for (const hit of hits) {
    console.log(`  ${hit.id}  ${hit.score.toFixed(3)}  ${hit.section}`);
  }
  console.log();
}

// ✓는 답변 안에 ID 글자가 있는지로만 판단한다 (괄호 모양은 따지지 않음)
function printEvidence(hits, answer, weak) {
  console.log("📚 근거 (LLM에게 넘긴 자료 · ✓ = 답변에 ID가 표시된 자료)");
  const cited = hits.map((hit) => answer.includes(hit.id));
  hits.forEach((hit, index) => {
    console.log(`  ${cited[index] ? "✓" : " "} ${hit.id}  ${hit.section}  ${hit.url}`);
  });
  if (weak) {
    console.log("  ⚠ 관련 자료가 약해 이 자료들을 답변의 근거로 보기 어렵습니다");
  } else if (!cited.some(Boolean)) {
    console.log("  (답변에 ID 표시가 없습니다. 위 자료와 답변을 비교해 확인하세요)");
  }
  console.log();
}

// 실험용: 검색 없이, 시스템 메시지도 없이 질문만 보낸다
async function runWithoutRag(question, showPrompt) {
  const messages = [{ role: "user", content: question }];
  if (showPrompt) return printMessages(messages);
  if (!(await ensureOllama())) return;

  const answerStart = performance.now();
  await streamAnswer(messages);
  console.log(`⏱ 답변 ${seconds(answerStart)}초`);
}

async function retrieve(question, k) {
  const searchStart = performance.now();
  const hits = await search(question, k);
  const searchTime = seconds(searchStart);
  const messages = [
    { role: "system", content: SYSTEM_MESSAGE },
    { role: "user", content: buildPrompt(question, hits) },
  ];
  return { hits, messages, searchTime };
}

// 🔎 검색 결과는 이미 출력된 뒤에 부른다
async function answerAndCite(hits, messages, searchTime) {
  const weak = hits.length === 0 || hits[0].score < WEAK_THRESHOLD;
  const answerStart = performance.now();
  const answer = await streamAnswer(messages);
  const answerTime = seconds(answerStart);
  printEvidence(hits, answer, weak);
  console.log(`⏱ 검색 ${searchTime}초 · 답변 ${answerTime}초`);
}

async function runWithRag(question, k, showPrompt) {
  const { hits, messages, searchTime } = await retrieve(question, k);
  if (showPrompt) return printMessages(messages);

  printSearchResults(hits, hits.length === 0 || hits[0].score < WEAK_THRESHOLD);
  if (!(await ensureOllama())) return;
  await answerAndCite(hits, messages, searchTime);
}

// 대화형: 준비(연결 확인·모델 불러오기)는 시작할 때 한 번만, 질문끼리는 서로 독립
async function runInteractive(k) {
  if (!(await ensureOllama())) return;
  await search("준비", 1); // 벡터 저장소 검사와 임베딩 모델 불러오기를 미리 해 둔다

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.on("SIGINT", () => {
    console.log("\n종료합니다.");
    process.exit(0);
  });

  console.log("물류창고 재고 조사 안내 챗봇입니다. 질문을 입력하세요. (끝내려면 exit)");
  rl.setPrompt("질문> ");
  rl.prompt();
  for await (const line of rl) {
    const question = line.trim();
    if (EXIT_WORDS.has(question.toLowerCase())) break;
    if (question !== "") {
      console.log();
      try {
        const { hits, messages, searchTime } = await retrieve(question, k);
        printSearchResults(hits, hits.length === 0 || hits[0].score < WEAK_THRESHOLD);
        await answerAndCite(hits, messages, searchTime);
      } catch (error) {
        console.error(`✗ 오류가 났습니다: ${error.message}`);
      }
      console.log();
    }
    rl.prompt();
  }
  rl.close();
  console.log("종료합니다.");
}

async function main() {
  const { question, k, showPrompt, noRag } = parseArgs(process.argv.slice(2));
  if (question === undefined) {
    await runInteractive(k);
  } else if (noRag) {
    await runWithoutRag(question, showPrompt);
  } else {
    await runWithRag(question, k, showPrompt);
  }
}

main().catch((error) => {
  console.error(`✗ ${error.message}`);
  process.exitCode = 1;
});
