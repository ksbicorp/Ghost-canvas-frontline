import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const isProd = process.env.NODE_ENV === 'production';

// Support large payloads for inline base64 image data
app.use(express.json({ limit: '50mb' }));

const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
const ai = new GoogleGenAI({
  apiKey,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

app.post('/api/gemini/generate', async (req, res) => {
  try {
    let { model, contents, config } = req.body;
    if (!model || !contents) {
      return res.status(400).json({ error: 'Missing model or contents' });
    }

    // Normalize model alias if user selected 2.0 or variant notation
    if (typeof model === 'string') {
      const cleanModel = model.replace(/^models\//, '');
      if (
        cleanModel === 'gemini-robotics-er-2.0-preview' ||
        cleanModel === 'gemini-robotics-er-2.0' ||
        cleanModel === 'gemini-robotics-er-2' ||
        cleanModel === 'gemini-robotics-er-2-preview'
      ) {
        model = 'gemini-robotics-er-2-preview';
      }
    }

    const response = await ai.models.generateContent({
      model,
      contents,
      config,
    });

    return res.json({ text: response.text });
  } catch (error: any) {
    console.error('Gemini API Error:', error);
    return res.status(500).json({
      error: error?.message || 'Error generating content',
      status: error?.status,
    });
  }
});

app.get('/api/gemini/generate', (_req, res) => {
  return res.status(200).json({
    retry: true,
    message: 'Auth redirect completed, please retry POST request.',
  });
});

app.use('/api', (req, res) => {
  return res.status(404).json({
    error: `API endpoint not found: ${req.method} ${req.originalUrl}`,
  });
});

async function startServer() {
  if (!isProd) {
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.use((_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`Server listening at http://0.0.0.0:${port}`);
  });
}

startServer();
