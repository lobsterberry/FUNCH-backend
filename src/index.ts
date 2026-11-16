import { createApp } from './app.js';

const port = process.env.PORT || 5000;
createApp().listen(port, () => {
  console.log(`Server is running on port ${port}`);
  console.log(`Healthcheck: http://localhost:${port}/health`);
});
