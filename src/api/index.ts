import { Anthropic } from "@anthropic-ai/sdk"
import { ApiConfiguration, ModelInfo } from "../shared/api"
import { AnthropicHandler } from "./providers/anthropic"
import { AwsBedrockHandler } from "./providers/bedrock"
import { OpenRouterHandler } from "./providers/openrouter"
import { VertexHandler } from "./providers/vertex"
import { OpenAiHandler } from "./providers/openai"
import { OllamaHandler } from "./providers/ollama"
import { LmStudioHandler } from "./providers/lmstudio"
import { GeminiHandler } from "./providers/gemini"
import { OpenAiNativeHandler } from "./providers/openai-native"
import { ApiStream } from "./transform/stream"
import { DeepSeekHandler } from "./providers/deepseek"

export interface ApiHandler {
	createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream
	getModel(): { id: string; info: ModelInfo }
}

export interface CompletionOptions {
    prompt: string;
    maxTokens: number;
    temperature: number;
    cursorPosition: number;
}

export interface CompletionResult {
    text: string;
    detail?: string;
}

export async function getCompletion(options: CompletionOptions): Promise<CompletionResult[]> {
    const lastLineBreakIndex = options.prompt.lastIndexOf('\n');
    const contextPrefix = options.prompt.substring(0, lastLineBreakIndex + 1) || '';
    const lastLine = options.prompt.substring(lastLineBreakIndex + 1);
    
    const prefix = contextPrefix + lastLine.substring(0, options.cursorPosition);
    const suffix = lastLine.substring(options.cursorPosition);

    const SYSTEM_MSG = `You are a HOLE FILLER. You are provided with a file containing holes, formatted as '{{HOLE_NAME}}'. Your TASK is to complete with a string to replace this hole with, inside a <COMPLETION/> XML tag, including context-aware indentation, if needed.  All completions MUST be truthful, accurate, well-written and correct.

## EXAMPLE QUERY:

<QUERY>
function sum_evens(lim) {
  var sum = 0;
  for (var i = 0; i < lim; ++i) {
    {{FILL_HERE}}
  }
  return sum;
}
</QUERY>

TASK: Fill the {{FILL_HERE}} hole.

## CORRECT COMPLETION

<COMPLETION>if (i % 2 === 0) {
      sum += i;
    }</COMPLETION>

## EXAMPLE QUERY:

<QUERY>
def sum_list(lst):
  total = 0
  for x in lst:
  {{FILL_HERE}}
  return total

print sum_list([1, 2, 3])
</QUERY>

## CORRECT COMPLETION:

<COMPLETION>  total += x</COMPLETION>

## EXAMPLE QUERY:

<QUERY>
// data Tree a = Node (Tree a) (Tree a) | Leaf a

// sum :: Tree Int -> Int
// sum (Node lft rgt) = sum lft + sum rgt
// sum (Leaf val)     = val

// convert to TypeScript:
{{FILL_HERE}}
</QUERY>

## CORRECT COMPLETION:

<COMPLETION>type Tree<T>
  = {$:"Node", lft: Tree<T>, rgt: Tree<T>}
  | {$:"Leaf", val: T};

function sum(tree: Tree<number>): number {
  switch (tree.$) {
    case "Node":
      return sum(tree.lft) + sum(tree.rgt);
    case "Leaf":
      return tree.val;
  }
}</COMPLETION>

## EXAMPLE QUERY:

The 5th {{FILL_HERE}} is Jupiter.

## CORRECT COMPLETION:

<COMPLETION>planet from the Sun</COMPLETION>

## EXAMPLE QUERY:

function hypothenuse(a, b) {
  return Math.sqrt({{FILL_HERE}}b ** 2);
}

## CORRECT COMPLETION:

<COMPLETION>a ** 2 + </COMPLETION>`;
    const fullPrompt =
        SYSTEM_MSG +
        `\n\n<QUERY>\n${prefix}{{FILL_HERE}}${suffix}\n</QUERY>\nTASK: Fill the {{FILL_HERE}} hole. Answer only with the CORRECT completion, and NOTHING ELSE. Do it now.\n<COMPLETION>`;

    const configuration: ApiConfiguration = {
        apiProvider: "anthropic",
        apiModelId: "claude-3-5-sonnet-20240620",
        apiKey: "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",
    };

    const handler = buildApiHandler(configuration);

    const messages: Anthropic.Messages.MessageParam[] = [
        {
            role: "user",
            content: `${fullPrompt}`
        }
    ];

    const stream = handler.createMessage("You are a HOLE FILLER.", messages);

    let responseText = '';
    try {
        for await (const chunk of stream) {
            if ('text' in chunk) {
                responseText += chunk.text;
            } else if (typeof chunk === 'string') {
                responseText += chunk;
            }
        }

        // 提取<COMPLETION>标签中的内容
        const completionMatch = responseText.match(/<COMPLETION>([\s\S]*?)<\/COMPLETION>/);
        const extractedText = completionMatch ? completionMatch[1] : '';

        return [{
            text: extractedText,
            detail: 'AI Completion'
        }];
    } catch (error) {
        console.error('Completion error:', error);
        return [{
            text: '',
            detail: 'Error generating completion'
        }];
    }
}

export function buildApiHandler(configuration: ApiConfiguration): ApiHandler {
	const { apiProvider, ...options } = configuration
	switch (apiProvider) {
		case "anthropic":
			return new AnthropicHandler(options)
		case "openrouter":
			return new OpenRouterHandler(options)
		case "bedrock":
			return new AwsBedrockHandler(options)
		case "vertex":
			return new VertexHandler(options)
		case "openai":
			return new OpenAiHandler(options)
		case "ollama":
			return new OllamaHandler(options)
		case "lmstudio":
			return new LmStudioHandler(options)
		case "gemini":
			return new GeminiHandler(options)
		case "openai-native":
			return new OpenAiNativeHandler(options)
		case "deepseek":
			return new DeepSeekHandler(options)
		default:
			return new AnthropicHandler(options)
	}
}
