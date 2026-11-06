# Ghost Canvas Frontline

```text
+------------------------------------------------------------------+
|                                                                  |
|   GHOST CANVAS FRONTLINE                                         |
|                                                                  |
|             SEE IT. UNDERSTAND IT. ACT ON IT.                    |
|                                                                  |
+------------------------------------------------------------------+
```

Ghost Canvas Frontline is a browser-based visual-understanding demo. Provide an image or share a browser-selected screen, ask a Gemini model about its visual content, and inspect structured results as overlays. The repository also includes an optional Python service for local desktop capture and input actions.

> **Prototype notice:** This is a demo, not a production-ready agent runtime. The browser app, Express/Gemini API proxy, and optional Python desktop-control service are separate components. Review the integration and security notes before connecting it to another backend or exposing any service.

## Features

- **2D object detection:** Request objects (for example, chairs) and display labeled bounding boxes.
- **Segmentation masks:** Show model-returned masks as colored overlays.
- **Pointing:** Display labeled points on the active image.
- **Ghost Canvas mode:** Share a browser-selected screen or window with `getDisplayMedia`, then ask the model to locate UI elements or other targets.
- **Image inputs:** Choose a sample image or upload JPG, PNG, or WebP.
- **Prompt and model controls:** Edit prompts, choose a model ID listed in the UI or enter a custom ID, and adjust temperature and the thinking option.
- **Request/response inspection:** Inspect the API payload and response; the image payload is redacted in the request panel.
- **Optional local desktop backend:** `backend_design.py` captures the host machine's screen, returns detections, and exposes basic click/move actions.

## Architecture

```text
+----------------------------+       POST /api/gemini/generate
| React + Vite browser app   | ----------------------------------+
| image/screen + overlays    |                                   |
+----------------------------+                                   v
                                                   +-------------------------+
                                                   | Express server          |
                                                   | server.ts               |
                                                   | Gemini API proxy        |
                                                   +------------+------------+
                                                                |
                                                                v
                                                        Gemini API

Optional local desktop flow:
Browser -- POST http://localhost:5000/detect --> Flask/Python service
                                                |-- captures host screen
                                                |-- calls Gemini
                                                `-- returns detections
```

The standard browser flow resizes the image to a maximum dimension of 640 pixels and sends it with the prompt to the Express proxy. The proxy uses `GEMINI_API_KEY` and returns the model text. The client parses that result and renders the supported overlays.

The **Remote Capture (Local)** button uses a separate flow and calls the Python service at `http://localhost:5000/detect`. That service captures the machine on which it is running; it is not the browser's screen-sharing flow.

## Run the browser app

### Requirements

- Node.js and npm
- A Gemini API key and access to a model ID supported by your account

### Setup

```bash
npm install
cp .env.example .env
```

Add your key to `.env`:

```dotenv
GEMINI_API_KEY=your_api_key_here
```

Start the app and server together:

```bash
npm run dev
```

Open the local URL printed by Vite. Choose a sample image or upload one, select a detection mode, enter a prompt, and click **Send**. For Ghost Canvas mode, choose **Start Screen Capture** and grant the browser permission.

Other package scripts include `npm run build`, `npm run lint`, and `npm start`. Check the deployment environment and Node.js version before using the production start script.

## Optional Python desktop backend

`backend_design.py` is a separate local service that uses Flask, screen-capture/desktop-automation libraries, Pillow, and the Gemini Python SDK. Install the dependencies required by the script, then run:

```bash
python backend_design.py
```

It listens on port `5000` by default. The **Remote Capture (Local)** UI action expects the service at `http://localhost:5000`.

### Python API

#### `POST /detect`

Example request:

```json
{
  "prompt": "Find the Save button",
  "region": [0, 0, 1280, 720]
}
```

`prompt` is optional and defaults to a general UI-detection prompt. `region` is optional and uses `[left, top, width, height]` in desktop pixels.

A successful response has this shape:

```json
{
  "detections": [
    {
      "label": "Save",
      "center": [640.0, 360.0],
      "box": [320.0, 500.0, 400.0, 780.0],
      "pyautogui_code": "pyautogui.click(640, 360)"
    }
  ],
  "raw_response": "..."
}
```

The box order is `[ymin, xmin, ymax, xmax]` in desktop pixels; `center` is `[x, y]`. The UI currently maps desktop coordinates to browser viewport dimensions approximately, so verify coordinates before relying on them.

#### `POST /execute`

Example request:

```json
{
  "x": 640,
  "y": 360,
  "action": "click"
}
```

Supported actions are `click` and `moveTo`. The endpoint invokes PyAutoGUI on the machine running the Python service. **It is unauthenticated in this prototype. Do not expose it to an untrusted network.**

## Express/Gemini integration

The browser app posts to the same-origin route `POST /api/gemini/generate`:

```json
{
  "model": "your-supported-model-id",
  "contents": {
    "parts": [
      {
        "inlineData": {
          "data": "BASE64_IMAGE_DATA",
          "mimeType": "image/png"
        }
      },
      { "text": "Describe or locate the target" }
    ]
  },
  "config": {
    "temperature": 0.2,
    "responseMimeType": "application/json"
  }
}
```

The Express server calls `@google/genai` and responds with `{ "text": "..." }`. It accepts JSON payloads up to 50 MB to support inline image data.

### Expected model output

For boxes and Ghost Canvas, the client expects an array such as:

```json
[{ "box_2d": [100, 120, 420, 560], "label": "button" }]
```

Coordinates are normalized to `0–1000` and ordered `[ymin, xmin, ymax, xmax]`. Point mode expects entries with `point` and `label`; segmentation mode expects `box_2d`, `label`, and a mask string. Validate model output before rendering or acting on it.

## Repository map

| File | Purpose |
| --- | --- |
| `App.tsx` | Main screen composition and request/response panels |
| `Content.tsx` | Image/screen preview and result overlays |
| `Prompt.tsx` | Prompt/model controls, image preparation, API calls, and response parsing |
| `DetectTypeSelector.tsx` | Detection mode selector |
| `SideControls.tsx`, `ExampleImages.tsx` | Upload and sample-image inputs |
| `atoms.tsx`, `Types.tsx`, `consts.tsx`, `utils.tsx`, `hooks.tsx` | Shared state, types, constants, and helpers |
| `server.ts` | Express server, Gemini proxy, and Vite hosting |
| `backend_design.py` | Optional Flask screen-capture and desktop-action prototype |
| `package.json` | Scripts and frontend/server dependencies |
| `.env.example` | Environment variable template |

## Security, privacy, and production checklist

- Screen sharing requires browser permission. Explain what is captured and where image data is sent.
- Image/screen content is sent to the configured Gemini service in the standard flow. Follow your organization's data-retention, privacy, and consent requirements.
- Keep `GEMINI_API_KEY` on the server, out of source control, and out of client bundles.
- The Express proxy has no authentication, authorization, rate limiting, or application-level request validation. Add these before exposing it beyond a trusted development setup.
- The Python service enables CORS for local development and has no authentication. Its `/execute` route can control the host desktop. Keep it in a trusted local environment; do not expose it publicly.
- Treat detection results as untrusted input, not authorization to click or otherwise interact with a system.
- Confirm licensing and third-party asset/model terms before redistribution or commercial use. Review applicable source notices and licenses.

## Technology

React 19, TypeScript, Vite, Jotai, Express, the Google GenAI SDK, and an optional Python/Flask + PyAutoGUI backend.
