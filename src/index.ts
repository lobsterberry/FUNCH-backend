import { createApp } from './app.js';
import { closeDatabasePool } from './lib/db.js';

const port = process.env.PORT || 5000;
const server = createApp().listen(port, () => {
  console.log(`Server is running on port ${port}`);
  console.log(`Healthcheck: http://localhost:${port}/health`);
});

function shutdown() {
  server.close(async () => {
    try {
      await closeDatabasePool();
    } catch (error) {
      console.error('Failed to close PostgreSQL pool', error);
      process.exitCode = 1;
    }
  });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
