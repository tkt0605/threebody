import readline from "readline";
import { Agent } from "../core/agent.js";

export async function startCLI(): Promise<void> {
  const agent = new Agent();
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("ThreeBody CLI — 'exit' で終了、'reset' で履歴クリア\n");

  const ask = (): void => {
    rl.question("You: ", async (input) => {
      const trimmed = input.trim();
      if (trimmed === "exit") {
        rl.close();
        return;
      }
      if (trimmed === "reset") {
        agent.resetHistory();
        console.log("履歴をクリアしました。\n");
        ask();
        return;
      }
      if (!trimmed) {
        ask();
        return;
      }
      try {
        const reply = await agent.chat(trimmed);
        console.log(`Assistant: ${reply}\n`);
      } catch (err) {
        console.error("Error:", err);
      }
      ask();
    });
  };

  ask();
}
