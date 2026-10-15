import { buildServer } from './server.js';
import { config } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './db/prisma.js';

async function main(): Promise<void> {
  const server = await buildServer();

  // Initialize PostgreSQL connection via Prisma
  try {
    await connectDatabase();
    server.log.info('Connected to PostgreSQL database');
  } catch (dbErr) {
    server.log.warn(dbErr, 'Could not connect to PostgreSQL on startup - will retry on requests');
  }

  try {
    const address = await server.listen({
      port: config.port,
      host: config.host,
    });
    server.log.info(`API server is running at ${address}`);
  } catch (err) {
    server.log.error(err, 'Failed to start API server');
    process.exit(1);
  }

  // Graceful shutdown handling
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  for (const signal of signals) {
    process.on(signal, async () => {
      server.log.info(`Received ${signal}, shutting down gracefully...`);
      try {
        await server.close();
        server.log.info('Fastify server closed');
        await disconnectDatabase();
        server.log.info('Prisma disconnected from database');
        process.exit(0);
      } catch (closeErr) {
        server.log.error(closeErr, 'Error while closing API server');
        process.exit(1);
      }
    });
  }
}

main();
