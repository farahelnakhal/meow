const API_KEY = Deno.env.get('GEMINI_API_KEY');

const MODEL = 'gemini-2.0-flash';

export async function generateJson<T>(systemInstruction: string, userPrompt: string): Promise<T> {
  if (!API_KEY) throw new Error('GEMINI_API_KEY is not set in Supabase secrets');

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: {
          temperature: 0.7,
          responseMimeType: 'application/json',
        },
      }),
    }
  );

  if (!res.ok) {
    throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  }

  const body = await res.json();
  const text = body?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned no text content');

  try {
    return JSON.parse(text) as T;
  } catch {
    // belt and braces — strip fences if responseMimeType is ignored
    const cleaned = text.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned) as T;
  }
}

export const GEMINI_MODEL = MODEL;