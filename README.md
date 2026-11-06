# Ghost Canvas Frontline

```text
   ____ _               _     ____anvas
  / ___| |__   ___  ___| |_  / ___|__ _ _ ____   _____ _ __
 | |  _| '_ \ / _ \/ __| __| | |   / _` | '__\ \ / / _ \ '__|
 | |_| | | | |  __/ (__| |_  | |__| (_| | |   \ V /  __/ |
  \____|_| |_|\___|\___|\__|  \____\__,_|_|    \_/ \___|_|

             SEE IT. UNDERSTAND IT. ACT ON IT.
```

Ghost Canvas Frontline is a browser-based visual understanding demo. It lets a person provide an image or share a screen, ask a Gemini model about visual content, and inspect structured results as overlays. The repository also contains an optional Python service for local desktop capture and input actions.

> **Integration note:** This is a demo/prototype, not a production-ready agent runtime. The browser app, Express/Gemini API proxy, and optional Python desktop-control service are separate pieces. Read the integration notes below before wiring it into another backend.

## What it does

- **2D object detection:** Ask for items (for example, “chairs”) and display labeled 2D bounding boxes.
- **Segmentation masks:** Visualize model-returned masks as colored overlays.
- **Pointing:** Display labeled points on the active image.
- **Ghost Canvas mode:** Share a browser-selected screen/window with `getDisplayMedia`, then ask the model to locate UI elements or other targets.
- **Image inputs:** Choose a sample image or upload JPG, PNG, or WebP.
- **Prompt and model controls:** Edit prompts, select from the model IDs listed in the UI (or enter a custom ID), and adjust temperature and the thinking option.
- **Visible request/response inspection:** The interface shows the API payload and response; the displayed image payload is redacted in the request panel.
- **Optional local desktop backend:** `backend_design.py` captures the host machine's screen, returns detections with coordinates, and exposes basic click/move actions.

## How the pieces fit together

```text
                         ┌──────────────────────────┐
                         │ React + Vite browser app │
                         │ image / shared screen    │
                         │ prompt + visual overlays │
                         └────────────┬─────────────┘
                                      │ POST /api/gemini/generate
                                      │ model + contents + config
                         ┌────────────▼─────────────┐
                         │ Express server (server.ts)│
                         │ Gemini API proxy         │
                         └────────────┬─────────────┘
                                      │ Gemini API
                                      ▼
                              structured text result

  Optional, separate local desktop path:
  Browser -- POST http://localhost:5000/detect --> Flask/Python
                                                  ├─ captures host screen
                                                  ├─ calls Gemini
                                                  └─ returns boxes / coordinates
```

The standard browser flow sends a resized image (maximum dimension 640 px) and prompt to the Express proxy. The proxy uses `GEMINI_API_KEY` and returns the model text. The client parses the result and renders boxes, points, or masks. In Ghost Canvas mode, the user must explicitly start screen sharing in the browser first.

The **Remote Capture (Local)** button is a different flow: it calls the Python service at `http://localhost:5000/detect`. That Python service captures the machine on which it is running; it does not receive the browser's shared-screen frame. The button currently sends a prompt, not a region. Treat `/execute` as a powerful local input-control endpoint, not as a harmless model API.

## Quick start: browser app and Gemini proxy

### Requirements

- Node.js with npm
- A Gemini API key and access to a model ID supported by your account

### Run locally

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

Open the local URL printed by Vite. Choose a sample image or upload one, select a detection mode, enter a prompt, and click **Send**. For Ghost Canvas, choose **Start Screen Capture** and grant the browser permission before sending a request.

Other package scripts are `npm run build`, `npm run lint`, and `npm start`; check the deployment environment and Node version before using the production start script.

## Optional Python desktop backend

`backend_design.py` is an alternative, local-only service. It uses Flask, screen-capture/desktop automation libraries, Pillow, and the Gemini Python SDK. Install the dependencies described in the script, configure `GEMINI_API_KEY`, then run:

```bash
python backend_design.py
```

It listens on port `5000` by default. The `Remote Capture (Local)` UI action expects this service to be reachable at `http://localhost:5000`.

### Python API contract

#### `POST /detect`

Request JSON:

```json
{
  "prompt": "Find the Save button",
  "region": [0, 0, 1280, 720]
}
```

`prompt` is optional (defaults to a general UI detection prompt). `region` is optional and is `[left, top, width, height]` in desktop pixels.

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

The box order is `[ymin, xmin, ymax, xmax]` in desktop pixels; `center` is `[x, y]`. The UI currently uses a rough mapping from these desktop coordinates to browser viewport dimensions, so do not assume its overlay coordinates are accurate for every display, scaling factor, or region.

#### `POST /execute`

Request JSON:

```json
{
  "x": 640,
  "y": 360,
  "action": "click"
}
```

Currently supported actions are `click` and `moveTo`. The endpoint invokes PyAutoGUI on the machine running the Python service. **It is not authenticated in this prototype. Do not expose it to a network, production environment, or untrusted users.** Add authentication, strict action/coordinate validation, authorization, rate limits, and explicit user confirmation before enabling any real-world desktop action.

## Express/Gemini integration contract

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

The Express server calls `@google/genai` and responds with `{ "text": "..." }`. It accepts JSON payloads up to 50 MB to support inline image data. If replacing this route with an existing backend, preserve the request shape or update the client call in `Prompt.tsx`; keep the Gemini credential on the server, never in browser code. The optional Python service uses a separate SDK and API path.

### Expected model output shapes

The UI depends on structured model responses. For boxes and Ghost Canvas, the client expects an array like:

```json
[{ "box_2d": [100, 120, 420, 560], "label": "button" }]
```

Coordinates are normalized to `0–1000`, ordered `[ymin, xmin, ymax, xmax]`. Point mode expects entries with `point` and `label`; segmentation mode expects `box_2d`, `label`, and a mask string. Keep output validation and error handling in the backend: model text is not guaranteed to be valid JSON. The Python prototype currently returns an empty detections list if parsing fails.

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

- Screen sharing requires browser permission; explain clearly what is captured and where image data is sent.
- Image/screen content is sent to the configured Gemini service in the standard flow. Apply your organization's data-retention, privacy, and consent requirements.
- Keep `GEMINI_API_KEY` on the server, out of source control, and out of client bundles.
- The Express proxy currently has no authentication, authorization, rate limiting, or application-level request validation. Add these before exposing it beyond a trusted development setup.
- The Python service enables CORS for local development and has no authentication. Its `/execute` route can control the host desktop. Keep it bound to a trusted local environment and add strong access controls before integration.
- Validate and constrain model output before rendering or acting on it. A detection result is untrusted input, not authorization to click or otherwise interact with a system.
- Confirm licensing and third-party asset/model terms before redistribution or commercial use. Source files contain Apache-2.0 headers attributed to Google; review the applicable notices and assets for the full licensing picture.

## Technology

React 19, TypeScript, Vite, Jotai, Express, the Google GenAI SDK, and an optional Python/Flask + PyAutoGUI backend.
