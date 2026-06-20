import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

/**
 * Gemini tool function declaration matching the API schema.
 */
export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface GeminiToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface GeminiMessage {
  role: 'user' | 'model';
  parts: Array<{ text?: string; functionCall?: GeminiToolCall; functionResponse?: { name: string; response: unknown } }>;
}

export interface GeminiResponse {
  text: string | null;
  toolCalls: GeminiToolCall[];
  finishReason: string;
  usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number; totalTokenCount: number };
}

/**
 * Low-level client for the Gemini API.
 *
 * IMPORTANT — Gemini 3-series models:
 * - Do NOT set temperature (leave at default 1.0).
 *   Older guidance recommending temperature=0 for function calling is outdated
 *   for this model family and can cause looping or degraded reasoning.
 */
@Injectable()
export class GeminiClientService implements OnModuleInit {
  private readonly logger = new Logger(GeminiClientService.name);
  private client: AxiosInstance;
  private model: string;
  private apiKey: string;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    this.apiKey = this.configService.get<string>('GEMINI_API_KEY', '');
    this.model = this.configService.get<string>('GEMINI_ORCHESTRATOR_MODEL', 'gemini-2.5-flash');

    if (!this.apiKey) {
      this.logger.warn('GEMINI_API_KEY not set — agent will not function');
    }

    this.client = axios.create({
      baseURL: 'https://generativelanguage.googleapis.com/v1beta',
      timeout: 120_000,
      headers: { 'Content-Type': 'application/json' },
    });

    this.logger.log(`GeminiClient initialized — model: ${this.model}`);
  }

  /**
   * Send a generateContent request to Gemini with optional tool declarations.
   *
   * NOTE: Temperature is intentionally NOT set. For Gemini 3-series models,
   * the default of 1.0 is correct. Setting temperature=0 causes looping
   * and degraded reasoning with function calling.
   */
  async generateContent(
    messages: GeminiMessage[],
    systemInstruction: string,
    tools?: GeminiFunctionDeclaration[],
  ): Promise<GeminiResponse> {
    const url = `/models/${this.model}:generateContent?key=${this.apiKey}`;

    const requestBody: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: messages,
      // No temperature set — intentional for Gemini 3-series models
      generationConfig: {
        maxOutputTokens: 8192,
      },
    };

    if (tools && tools.length > 0) {
      requestBody.tools = [
        {
          functionDeclarations: tools,
        },
      ];
      // Allow the model to decide when to call functions
      requestBody.toolConfig = {
        functionCallingConfig: { mode: 'AUTO' },
      };
    }

    const startTime = Date.now();
    try {
      const response = await this.client.post(url, requestBody);
      const elapsed = Date.now() - startTime;

      const candidate = response.data?.candidates?.[0];
      const content = candidate?.content;
      const finishReason = candidate?.finishReason ?? 'UNKNOWN';
      const usageMetadata = response.data?.usageMetadata;

      // Extract text and tool calls from response parts
      let text: string | null = null;
      const toolCalls: GeminiToolCall[] = [];

      if (content?.parts) {
        for (const part of content.parts) {
          if (part.text) {
            text = (text ?? '') + part.text;
          }
          if (part.functionCall) {
            toolCalls.push({
              name: part.functionCall.name,
              args: part.functionCall.args ?? {},
            });
          }
        }
      }

      this.logger.log(
        `[Gemini] generateContent — success — elapsed: ${elapsed}ms, ` +
        `finishReason: ${finishReason}, toolCalls: ${toolCalls.length}, ` +
        `tokens: ${usageMetadata?.totalTokenCount ?? 'N/A'}`,
      );

      return { text, toolCalls, finishReason, usageMetadata };
    } catch (err: any) {
      const elapsed = Date.now() - startTime;
      const status = err?.response?.status;
      const errorMessage = err?.response?.data?.error?.message ?? err.message;

      this.logger.error(
        `[Gemini] generateContent — failed — elapsed: ${elapsed}ms` +
        `${status ? `, status: ${status}` : ''}, error: ${errorMessage}`,
        err.stack,
      );

      throw new Error(`Gemini API error: ${errorMessage}`);
    }
  }
}
