import { Injectable, Logger } from '@nestjs/common';
import { GeminiFunctionDeclaration } from '../gemini-client.service';
import { JobTools } from './job-tools';
import { ApplyTools } from './apply-tools';
import { ColdEmailDrafterService } from './cold-email-drafter.service';
import { InboxReaderService } from './inbox-reader.service';
import { ReplyDrafterService } from './reply-drafter.service';

export interface AgentTool {
  name: string;
  declaration: GeminiFunctionDeclaration;
  execute(args: Record<string, unknown>): Promise<unknown>;
}

/**
 * Central registry for all agent tools.
 * Provides function declarations to Gemini and routes tool calls to implementations.
 */
@Injectable()
export class ToolRegistry {
  private readonly logger = new Logger(ToolRegistry.name);
  private readonly tools: Map<string, AgentTool> = new Map();

  constructor(
    private readonly jobTools: JobTools,
    private readonly applyTools: ApplyTools,
    private readonly coldEmailDrafter: ColdEmailDrafterService,
    private readonly inboxReader: InboxReaderService,
    private readonly replyDrafter: ReplyDrafterService,
  ) {
    this.register(jobTools);
    this.register(applyTools);
    this.register(coldEmailDrafter);
    this.register(inboxReader);
    this.register(replyDrafter);

    this.logger.log(`ToolRegistry initialized with ${this.tools.size} tools`);
  }

  private register(tool: AgentTool) {
    this.tools.set(tool.name, tool);
  }

  /**
   * Get all tool declarations for sending to Gemini.
   */
  getDeclarations(): GeminiFunctionDeclaration[] {
    return Array.from(this.tools.values()).map((t) => t.declaration);
  }

  /**
   * Execute a tool by name with the given arguments.
   */
  async execute(name: string, args: Record<string, unknown>): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Unknown tool: "${name}". Available: ${Array.from(this.tools.keys()).join(', ')}`);
    }
    return tool.execute(args);
  }

  /**
   * Check if a tool exists.
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * List registered tool names.
   */
  listTools(): string[] {
    return Array.from(this.tools.keys());
  }
}
