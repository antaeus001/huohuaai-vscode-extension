import * as vscode from 'vscode';
import { getCompletion } from '../../api';
import { ProviderResult } from 'vscode';
import { ClineProvider } from '../../core/webview/ClineProvider';

export class AICompletionProvider implements vscode.InlineCompletionItemProvider {
    private outputChannel: vscode.OutputChannel;
    private lastTriggerTime: number = 0;
    private readonly TRIGGER_DELAY = 1000;
    private lastInput: { line: number; character: number; text: string } | null = null;
    private lastCompletionText: string | null = null;
    private lastCompetionList: vscode.InlineCompletionList | undefined;

    constructor() {
        this.outputChannel = vscode.window.createOutputChannel("AI Completion");
    }

    public async provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken
    ): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList | undefined> {        
        if (token.isCancellationRequested) {
            return undefined;
        }
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.selections.length > 1) {
          return undefined;
        }
        if (
            context.selectedCompletionInfo &&
            !context.selectedCompletionInfo.text.startsWith(
              document.getText(context.selectedCompletionInfo.range),
            )
          ) {
            return undefined;
        }
        this.outputChannel.appendLine(`\n内联补全被触发 - 位置: ${position.line}:${position.character}`);
        
        const currentLine = document.lineAt(position.line).text;
        const linePrefix = currentLine.substring(0, position.character);
        const lineSuffix = currentLine.substring(position.character);
        
        this.outputChannel.appendLine(`当前行文本: ${linePrefix}|${lineSuffix}`);

        // 检查是否与上次输入相同（移到最前面）
        const currentInput = {
            line: position.line,
            character: position.character,
            text: linePrefix
        };

        if (this.lastInput && 
            this.lastInput.line === currentInput.line &&
            this.lastInput.character === currentInput.character &&
            this.lastInput.text === currentInput.text) {
            this.outputChannel.appendLine('与上次输入相同，不触发补全');
            //在这里停顿10秒
            //await new Promise(resolve => setTimeout(resolve, 10000));
            return this.lastCompetionList;
        }

        this.lastInput = currentInput;

        if (this.lastCompletionText && document.lineAt(position.line).text.trim() === this.lastCompletionText.trim()) {
            this.outputChannel.appendLine('当前行与上次补全内容相同，不触发补全');
            return this.lastCompetionList;
        }

        if (!this.shouldTriggerCompletion(document, position, linePrefix)) {
            return undefined;
        }

        try {
            const contextRange = this.getContextRange(document, position);
            const contextText = document.getText(contextRange);

            this.outputChannel.appendLine('正在请求 AI 补全...');
            
            const provider = ClineProvider.getVisibleInstance();
            if (!provider) {
                this.outputChannel.appendLine('无法获取当前配置');
                return undefined;
            }

            const { apiConfiguration } = await provider.getState();
            this.outputChannel.appendLine(`使用模型: ${apiConfiguration.apiProvider}/${apiConfiguration.apiModelId}`);
            
            const completions = await getCompletion({
                prompt: contextText,
                maxTokens: 50,
                temperature: 0.2,
                cursorPosition: position.character,
                configuration: apiConfiguration  // 直接传入完整的配置
            });

            if (!completions || completions.length === 0) {
                this.outputChannel.appendLine('未获得补全建议');
                return undefined;
            }

            this.outputChannel.appendLine(`获得 ${completions.length} 个补全建议`);
            this.lastTriggerTime = Date.now();

            const items = completions.map(completion => {
                this.outputChannel.appendLine(`补全建议: ${completion.text}`);
                this.lastCompletionText = completion.text;
                return {
                    insertText: completion.text,
                    range: new vscode.Range(position, position)
                };
            });

            // 使用InlineCompletionList并设置一些属性
            const list = new vscode.InlineCompletionList(items);
            list.items = items.map(item => {
                const completionItem = new vscode.InlineCompletionItem(item.insertText);
                completionItem.range = item.range;
                return completionItem;
            });

            this.outputChannel.appendLine(`创建补全列表: ${JSON.stringify(list, null, 2)}`);
            this.lastCompetionList = list; // 存储最后一次的补全列表
            return list;
        } catch (error) {
            this.outputChannel.appendLine(`补全错误: ${error}`);
            console.error('AI 补全失败:', error);
            return undefined;
        }
    }

    private shouldTriggerCompletion(
        document: vscode.TextDocument,
        position: vscode.Position,
        linePrefix: string,
    ): boolean {
        // 频率限制
        const now = Date.now();
        if (now - this.lastTriggerTime < this.TRIGGER_DELAY) {
            this.outputChannel.appendLine('触发太频繁，跳过');
            return false;
        }

        this.outputChannel.appendLine(`检查是否应该触发补全:`);
        this.outputChannel.appendLine(`- 文档语言: ${document.languageId}`);
        this.outputChannel.appendLine(`- 位置: ${position.line}:${position.character}`);
        this.outputChannel.appendLine(`- 行前缀: "${linePrefix}"`);
        
        // 获取前面几行的内容作为上下文
        const prevLines = [];
        for (let i = Math.max(0, position.line - 3); i < position.line; i++) {
            prevLines.push(document.lineAt(i).text.trim());
        }
        
        // 如果当前行为空但有上下文，允许触发
        if (linePrefix.trim() === '' && prevLines.some(line => line !== '')) {
            this.outputChannel.appendLine('当前行为空，但有上下文，允许触发');
            return true;
        }

        // 如果当前行不为空，也允许触发
        if (linePrefix.trim() !== '') {
            this.outputChannel.appendLine('当前行不为空，允许触发');
            return true;
        }

        if (this.isInComment(document, position)) {
            this.outputChannel.appendLine('在注释中，不触发补全');
            return false;
        }

        if (this.isInString(linePrefix)) {
            this.outputChannel.appendLine('在字符串中，不触发补全');
            return false;
        }

        this.outputChannel.appendLine('无有效上下文，不触发补全');
        return false;
    }

    private isInComment(document: vscode.TextDocument, position: vscode.Position): boolean {
        const line = document.lineAt(position.line).text;
        const prefix = line.substring(0, position.character);
        
        if (prefix.match(/\/\//)) {
            return true;
        }
        
        const text = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
        const commentStart = text.lastIndexOf('/*');
        const commentEnd = text.lastIndexOf('*/');
        return commentStart > commentEnd;
    }

    private isInString(linePrefix: string): boolean {
        let inString = false;
        let quote: string | null = null;
        
        for (const char of linePrefix) {
            if ((char === '"' || char === "'") && quote === null) {
                quote = char;
                inString = true;
            } else if (char === quote && quote !== null) {
                if (linePrefix[linePrefix.length - 1] !== '\\') {
                    inString = !inString;
                }
            }
        }
        
        return inString;
    }

    private getContextRange(document: vscode.TextDocument, position: vscode.Position): vscode.Range {
        const startLine = Math.max(0, position.line - 3);
        const endLine = Math.min(document.lineCount, position.line + 1);
        return new vscode.Range(
            new vscode.Position(startLine, 0),
            position
        );
    }
}
