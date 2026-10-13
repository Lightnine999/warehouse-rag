# CLAUDE.md

## 제품

- **사용자**: 물류창고에 새로 온 작업자
- **불편한 점**: 재고 실사 절차와 용어를 매번 선임에게 물어봐야 한다.
- **만드는 것**: 질문하면 SOP와 공개 자료를 근거로 알려 주는 챗봇
- **1단계**: 질문과 비슷한 자료를 찾아서 보여 준다.
- **2단계**: 찾은 자료를 질문과 함께 LLM에 넣어 답을 받는다.

## 비목표

이번에는 아래를 만들지 않는다.

- 웹 화면
- 서버
- 배포
- 실시간 재고 수량 조회 (WMS 연동)
- 로그인

## 환경

- 내 PC에서만 실행한다.
- Node.js로 만든다.
- LLM은 Ollama의 `qwen3.5:2b`를 쓴다.

## 작업 규칙

- 내가 요청한 것만 만든다.
- 모르는 사실이나 URL은 지어내지 않는다.
- 만든 뒤 직접 실행해 보고 결과를 같이 보여 준다.

## 데이터 계약

- 청크 원본은 `data/chunks.json`이다. 배열이고, 각 항목은 `{ id, text, url, section }`이다.
- `id`는 `WH-001`부터 연속으로 붙인다. 한 번 붙인 `id`의 뜻은 바꾸지 않는다.
- `text`는 최소 120자이고, 사실 하나만 담는다. 원문에 없는 말을 보태지 않는다.
- `url`은 확인 가능한 출처다. 웹 자료는 퍼센트 인코딩된 주소를 쓰고, 내 SOP는 `docs/sop.md#제목`으로 쓴다(제목의 공백은 하이픈).

## 임베딩 계약

- 모델은 `onnx-community/embeddinggemma-300m-ONNX`이다. transformers.js의 `pipeline("feature-extraction", MODEL, { dtype: "q8" })`로 만들고, 호출 옵션은 `{ pooling: "mean", normalize: true }`, 차원은 768이다.
- 입력 형식: 문서는 `"title: " + section + " | text: " + text`, 질문은 `"task: search result | query: " + question`이다.
- `src/embedder.mjs` 한 곳에서만 정의하고, 파이프라인은 한 번만 만들어 재사용한다. export는 `embedDocument(chunk)`, `embedQuery(question)`, `MODEL`, `DTYPE`, `DIM`이다.
- 벡터 저장소는 `data/vectors.json`이고, 형식은 `{ model, dtype, dim, createdAt, chunks: [{ id, text, url, section, vector }] }`이다.
- 저장소의 `model`·`dtype`이 현재 embedder와 다르면 검색을 거부하고 "build-index를 다시 실행하라"고 안내한다.

## 검색 계약

- 벡터는 정규화되어 있으므로 코사인 유사도는 내적과 같다. 점수 내림차순으로 top-k(기본 3)를 돌려준다.
- 약한 근거 기준 `WEAK_THRESHOLD = 0.55`는 `src/search.mjs`에서만 정의·export하고, 다른 파일은 import해서 쓴다.
- 1위 점수가 `WEAK_THRESHOLD`보다 낮으면 "관련 자료가 약함"을 표시한다. 결과는 버리지 않는다.
- `search.mjs`는 다른 파일이 `search()`를 import해도 CLI가 실행되지 않게, 직접 실행됐을 때만 CLI를 돈다(`import.meta.url === pathToFileURL(process.argv[1]).href` 확인).

## 결정 필요

아직 정하지 않은 것들이다. 정해지면 위 절로 옮긴다.

- SOP와 공개 자료는 어떤 파일 형식으로, 어디에 둘 것인가?
- LLM에게 어떤 규칙을 줄 것인가? (예: 자료에 없는 내용을 물었을 때의 대응, 근거 표시 방식)
- 웹 화면이 없으니 작업자는 질문을 어떻게 입력하고 답을 어떻게 볼 것인가?
