import fastify from "fastify";

const app = fastify();

app.get("/api/v1/health", async () => ({ ok: true }));

const port = Number(process.env.API_PORT) || 9000;
const host = "0.0.0.0";

async function start() {
  try {
    await app.listen({ port, host });
    console.log(`API listening on http://${host}:${port}`);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

start();
