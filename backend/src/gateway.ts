import "dotenv/config";
import { startCLI } from "./channels/cli.js";
import { startServer } from "./channels/server.js";

const channel = process.argv[2] ?? "cli";

switch (channel) {
  case "cli":
    await startCLI();
    break;
  case "server":
    startServer(Number(process.env.PORT) || 3000);
    break;
  default:
    console.error(`Unknown channel: ${channel}`);
    process.exit(1);
}
