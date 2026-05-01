import Anthropic from "@anthropic-ai/sdk";

export interface Message {
  role: "user" | "assistant";
  content: string;
}

export class Agent {
  private client: Anthropic;
  private history: Message[] = [];
  private systemPrompt: string;

  constructor(systemPrompt = "You are a helpful assistant.") {
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
    this.systemPrompt = systemPrompt;
  }

  async chat(userMessage: string): Promise<string> {
    this.history.push({ role: "user", content: userMessage });
    const response = await this.client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: this.systemPrompt,
      messages: this.history,
    });
    const reply =
      response.content[0]?.type === "text" ? response.content[0].text : "";
    this.history.push({ role: "assistant", content: reply });
    return reply;
  }

  resetHistory(): void {
    this.history = [];
  }
}
