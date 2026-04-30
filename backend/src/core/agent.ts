import Anthropic = require("@anthropic-ai/sdk");
export interface Message{
    role: "user" | "assistant";
    content: string
}

export class Agent{
}