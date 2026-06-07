import { requestUrl } from 'obsidian';
import type { ProviderChatMessage, ProviderChatResult } from './providerClient';

export interface GeminiChatRequest {
  endpointUrl: string;
  model: string;
  apiKey: string;
  messages: ProviderChatMessage[];
  temperature?: number;
}

export function buildGeminiUrl(endpointUrl: string, model: string, apiKey: string): string {
  const base = endpointUrl.replace(/\/$/, '');
  return `${base}/v1beta/models/${model}:generateContent?key=${apiKey}`;
}

export async function postGeminiChat(request: GeminiChatRequest): Promise<ProviderChatResult> {
  const url = buildGeminiUrl(request.endpointUrl, request.model, request.apiKey);

  const systemMessages = request.messages.filter((m) => m.role === 'system');
  const otherMessages = request.messages.filter((m) => m.role === 'user' || m.role === 'assistant');

  const systemInstruction =
    systemMessages.length > 0
      ? {
          parts: systemMessages.map((m) => ({
            text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
          })),
        }
      : undefined;

  const contents = otherMessages.map((m) => {
    const role = m.role === 'assistant' ? 'model' : 'user';
    if (typeof m.content === 'string') {
      return {
        role,
        parts: [{ text: m.content }],
      };
    } else {
      const parts = m.content.map((part) => {
        if (part.type === 'text') {
          return { text: part.text };
        } else {
          const match = part.image_url.url.match(/^data:(image\/[a-zA-Z+.-]+);base64,(.+)$/);
          if (match) {
            const [, mimeType, data] = match;
            return {
              inlineData: {
                mimeType,
                data,
              },
            };
          }
          return { text: `[Malformed Image: ${part.image_url.url.slice(0, 100)}]` };
        }
      });
      return { role, parts };
    }
  });

  const payload: Record<string, any> = {
    contents,
    generationConfig: {
      temperature: request.temperature ?? 0,
      responseMimeType: 'application/json',
    },
  };

  if (systemInstruction) {
    payload.systemInstruction = systemInstruction;
  }

  try {
    const response = await requestUrl({
      url,
      method: 'POST',
      throw: false,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (response.status !== 200) {
      return {
        ok: false,
        error: `Gemini API returned status ${response.status}`,
        status: response.status,
        responseBody: response.text,
      };
    }

    const json = JSON.parse(response.text);
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== 'string') {
      return {
        ok: false,
        error: 'Invalid response format from Gemini API',
        status: response.status,
        responseBody: response.text,
      };
    }

    return {
      ok: true,
      status: response.status,
      content: text,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
