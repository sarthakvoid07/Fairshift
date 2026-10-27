// Vercel entry point: runs the same app as src/server.js inside a serverless function.
import { createApp } from '../src/server.js';

const app = createApp();

export default function handler(req, res) {
  app.emit('request', req, res);
}