// 생성 계약(CLAUDE.md)대로 LLM에 보낼 메시지를 조립한다
import { WEAK_THRESHOLD } from "./search.mjs";

export const SYSTEM_MESSAGE =
  "당신은 물류창고에 새로 온 작업자를 돕는 안내 도우미입니다. 한국어로 짧고 쉽게 답합니다. " +
  "실시간 재고 수량처럼 자료로 알 수 없는 것은 모른다고 답하고, 재고 수량은 WMS에서 확인하라고 안내합니다.";

const INTRO = "다음 자료는 물류창고 재고 조사에 관한 공개 문서와 현장 SOP에서 뽑은 조각입니다.";
const GROUNDING_STRONG = "자료에 근거한 내용만 답하고, 자료에 없으면 없다고 말합니다.";
const GROUNDING_WEAK =
  "주의: 검색된 조각의 유사도가 낮습니다. 질문과 완전히 맞는 근거가 아닐 수 있으니, " +
  "근거에 있는 내용만 짧게 답하고 자료에 없는 부분은 없다고 말합니다.";
const CITATION_RULE = "근거가 된 조각의 ID만 [WH-000]처럼 대괄호로 감싸 해당 문장 끝에 표시합니다.";
const CITATION_REMINDER = "(답할 때 근거로 쓴 자료의 ID를 [WH-000]처럼 문장 끝에 붙입니다.)";

const KST_FORMAT = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "long",
  hour: "numeric",
  minute: "numeric",
});

// now는 테스트에서 시각을 고정할 때만 넘긴다
export function buildPrompt(question, hits, now = new Date()) {
  const weak = hits.length === 0 || hits[0].score < WEAK_THRESHOLD;
  const lines = [
    INTRO, // ① 자료 소개
    weak ? GROUNDING_WEAK : GROUNDING_STRONG, // ② 근거 원칙
    CITATION_RULE, // ③ 출처 규칙
    // ④ KST 현재 시각
    "현재 시각은 " + KST_FORMAT.format(now) +
      "(KST)입니다. '지금', '올해', '다음 주' 같은 상대 표현은 이 시각을 기준으로 해석합니다.",
    "",
    "[자료]", // ⑤ 자료 (대괄호 안에는 ID만)
    hits.map((hit) => `[${hit.id}] (${hit.section}) ${hit.text}`).join("\n\n"),
    "",
    "[질문]", // ⑥ 질문
    question,
    "",
    CITATION_REMINDER, // ⑦ 출처 규칙 한 번 더
  ];
  return lines.join("\n");
}
