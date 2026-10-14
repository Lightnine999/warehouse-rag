// Ollama 호출 (생성 계약: qwen3.5:2b, /api/chat 스트리밍)
export const OLLAMA_URL = "http://localhost:11434";
export const LLM_MODEL = "qwen3.5:2b";

// 연결 확인: GET /api/tags 성공 여부
export async function pingOllama() {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`);
    return response.ok;
  } catch {
    return false;
  }
}

// 조각이 올 때마다 onToken을 부르고, 끝나면 전체 답변을 돌려준다
export async function chatStream(messages, onToken) {
  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages,
      stream: true,
      think: false,
      options: { temperature: 0 },
    }),
  });
  if (!response.ok) {
    throw new Error(`Ollama 응답 오류 ${response.status}: ${await response.text()}`);
  }

  let answer = "";
  const handleLine = (line) => {
    if (line.trim() === "") return;
    const data = JSON.parse(line);
    if (data.error) throw new Error(`Ollama 오류: ${data.error}`);
    const token = data.message?.content ?? "";
    if (token) {
      answer += token;
      onToken(token);
    }
  };

  // 응답은 NDJSON(줄마다 JSON 하나). 한글이 조각 경계에서 잘리지 않게 stream 모드로 디코딩한다
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop(); // 덜 받은 마지막 줄은 다음 조각과 합친다
    lines.forEach(handleLine);
  }
  buffer += decoder.decode();
  handleLine(buffer);

  return answer;
}
