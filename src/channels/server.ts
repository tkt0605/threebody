import http from "http";
import { Agent } from "../core/agent.js";

export function startServer(port = 3000): void {
  const agent = new Agent();

  const server = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/chat") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", async () => {
        let message: string;
        try {
          ({ message } = JSON.parse(body) as { message: string });
          if (typeof message !== "string") throw new Error("missing message");
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid request: body must be { message: string }" }));
          return;
        }
        try {
          const reply = await agent.chat(message);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ reply }));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("[chat error]", msg);
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: msg }));
        }
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.on("error", (err) => {
    console.error("[server error]", err.message);
    process.exit(1);
  });

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });
}
