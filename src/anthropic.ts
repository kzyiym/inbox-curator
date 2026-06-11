import { requestUrl } from 'obsidian';
import type { ProviderChatMessage, ProviderChatResult } from './providerClient';

export interface AnthropicChatRequest {
  endpointUrl: string;
  model: string;
  apiKey: string;
  messages: ProviderChatMessage[];
  temperature?: number;
  timeoutMs?: number;
  maxOutputTokens?: number;
}

type AnthropicImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

export async function postAnthropicChat(request: AnthropicChatRequest): Promise<ProviderChatResult> {
  const base = request.endpointUrl.replace(/\/$/, '');
  const url = `${base}/v1/messages`;

  const systemMessages = request.messages.filter((m) => m.role === 'system');
  const otherMessages = request.messages.filter((m) => m.role === 'user' || m.role === 'assistant');

  const systemInstruction = systemMessages.map((m) => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('\n\n');

  const payload: Record<string, any> = {
    model: request.model,
    messages: otherMessages.map((m) => {
      if (typeof m.content === 'string') {
        return {
          role: m.role,
          content: m.content,
        };
      } else {
        const content = m.content.map((part) => {
          if (part.type === 'text') {
            return {
              type: 'text' as const,
              text: part.text,
            };
          } else {
            const match = part.image_url.url.match(/^data:(image\/[a-zA-Z+.-]+);base64,(.+)$/);
            if (match) {
              const [, mediaType, data] = match;
              return {
                type: 'image' as const,
                source: {
                  type: 'base64' as const,
                  media_type: mediaType as AnthropicImageMediaType,
                  data,
                },
              };
            }
            return {
              type: 'text' as const,
              text: `[Malformed Image: ${part.image_url.url.slice(0, 100)}]`,
            };
          }
        });
        return { role: m.role, content };
      }
    }),
    max_tokens: request.maxOutputTokens ?? 4096,
    temperature: request.temperature ?? 0,
  };

  if (systemInstruction) {
    payload.system = systemInstruction;
  }

  try {
    const response = await requestUrl({
      url,
      method: 'POST',
      throw: false,
      headers: {
        'x-api-key': request.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      timeout: request.timeoutMs,
    });

    if (response.status !== 200) {
      return {
        ok: false,
        error: `Anthropic API returned status ${response.status}`,
        status: response.status,
        responseBody: response.text,
      };
    }

    const json = JSON.parse(response.text);
    const text = json.content?.[0]?.text;
    if (typeof text !== 'string') {
      return {
        ok: false,
        error: 'Invalid response format from Anthropic API',
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
