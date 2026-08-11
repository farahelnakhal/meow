const API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL = 'gemini-2.0-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

type Part = { text: string } | { inline_data: { mime_type: string; data: string } };

async function call(systemInstruction: string, parts: Part[], temperature: number) {
  if (!API_KEY) throw new Error('GEMINI_API_KEY is not set in Supabase secrets');

  const res = await fetch(`${ENDPOINT}?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: 'user', parts }],
      generationConfig: { temperature, responseMimeType: 'application/json' },
    }),
  });

  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 400)}`);

  const body = await res.json();
  const text = body?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    const reason = body?.candidates?.[0]?.finishReason ?? 'unknown';
    throw new Error(`Gemini returned no text (finishReason: ${reason})`);
  }
  return text as string;
}

function parseJson<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    // belt and braces if responseMimeType is ignored
    const cleaned = text.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned) as T;
  }
}

export async function generateJson<T>(systemInstruction: string, userPrompt: string, temperature = 0.7): Promise<T> {
  return parseJson<T>(await call(systemInstruction, [{ text: userPrompt }], temperature));
}

//vision call: image bytes plus the pass/fail criterion
export async function verifyImageJson<T>(
  systemInstruction: string,
  userPrompt: string,
  imageBase64: string,
  mimeType: string
): Promise<T> {
  const parts: Part[] = [
    { inline_data: { mime_type: mimeType, data: imageBase64 } },
    { text: userPrompt },
  ];
  //verification should be as repeatable as possible
  return parseJson<T>(await call(systemInstruction, parts, 0.1));
}

export const GEMINI_MODEL = MODEL;