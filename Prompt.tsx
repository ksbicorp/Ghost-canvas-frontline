/* tslint:disable */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Copyright 2025 Google LLC

// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at

//     https://www.apache.org/licenses/LICENSE-2.0

// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import {useAtom} from 'jotai';
import getStroke from 'perfect-freehand';
import React, {useState} from 'react';
import {
  BoundingBoxMasksAtom,
  BoundingBoxes2DAtom,
  DetectTypeAtom,
  HoverEnteredAtom,
  ImageSrcAtom,
  IsLoadingAtom,
  IsThinkingEnabledAtom,
  LinesAtom,
  PointsAtom,
  PromptsAtom,
  RequestJsonAtom,
  ResponseJsonAtom,
  SelectedModelAtom,
  TemperatureAtom,
} from './atoms';
import {lineOptions} from './consts';
import {DetectTypes} from './Types';
import {getSvgPathFromStroke, loadImage} from './utils';

export function Prompt() {
  const [temperature, setTemperature] = useAtom(TemperatureAtom);
  const [, setBoundingBoxes2D] = useAtom(BoundingBoxes2DAtom);
  const [, setBoundingBoxMasks] = useAtom(BoundingBoxMasksAtom);
  const [detectType] = useAtom(DetectTypeAtom);
  const [, setPoints] = useAtom(PointsAtom);
  const [, setHoverEntered] = useAtom(HoverEnteredAtom);
  const [lines] = useAtom(LinesAtom);
  const [imageSrc] = useAtom(ImageSrcAtom);
  const [targetPrompt, setTargetPrompt] = useState('items');
  const [selectedModel, setSelectedModel] = useAtom(SelectedModelAtom);
  const [isThinkingEnabled, setIsThinkingEnabled] = useAtom(
    IsThinkingEnabledAtom,
  );

  const [prompts, setPrompts] = useAtom(PromptsAtom);
  const [isLoading, setIsLoading] = useAtom(IsLoadingAtom);
  const [, setRequestJson] = useAtom(RequestJsonAtom);
  const [, setResponseJson] = useAtom(ResponseJsonAtom);
  const [responseTime, setResponseTime] = useState<string | null>(null);
  const [customModelId, setCustomModelId] = useState('');
  const [isRemoteBackendActive, setIsRemoteBackendActive] = useState(false);

  const is2d = detectType === '2D bounding boxes';

  const currentModel = selectedModel;

  const get2dPrompt = () =>
    `Detect ${targetPrompt}, with no more than 20 items. Output a json list where each entry contains the 2D bounding box in "box_2d" and a text label in "label".`;

  const getGenericPrompt = (type: DetectTypes) => {
    if (!prompts[type] || prompts[type].length < 3)
      return prompts[type]?.join(' ') || '';
    const [p0, p1, p2] = prompts[type];
    return `${p0} ${p1}${p2}`;
  };

  async function handleRemoteSend() {
    setIsLoading(true);
    setRequestJson('Requesting detection from local Python backend (localhost:5000)...');
    setResponseJson('');
    try {
      const res = await fetch('http://localhost:5000/detect', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({prompt: targetPrompt || prompts[detectType]?.[1] || 'UI elements'}),
      });
      const data = await res.json();
      setResponseJson(JSON.stringify(data, null, 2));
      if (data.detections) {
         setBoundingBoxes2D(data.detections.map((d: any) => ({
           x: (d.box[1]) / screen.width, // This is a rough mapping from absolute to relative for visualization
           y: (d.box[0]) / screen.height,
           width: (d.box[3] - d.box[1]) / screen.width,
           height: (d.box[2] - d.box[0]) / screen.height,
           label: d.label
         })));
      }
    } catch (err) {
      console.error(err);
      setResponseJson('Could not connect to local backend. Make sure backend_design.py is running on port 5000.');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSend() {
    setIsLoading(true);
    setRequestJson('');
    setResponseJson('');
    setBoundingBoxes2D([]);
    setBoundingBoxMasks([]);
    setPoints([]);
    setResponseTime(null);
    const startTime = performance.now();
    try {
      let activeDataURL;
      const maxSize = 640;
      const copyCanvas = document.createElement('canvas');
      const ctx = copyCanvas.getContext('2d')!;

      if (detectType === 'Ghost canvas') {
        const video = document.querySelector('video');
        if (video) {
          const scale = Math.min(
            maxSize / video.videoWidth,
            maxSize / video.videoHeight,
          );
          copyCanvas.width = video.videoWidth * scale;
          copyCanvas.height = video.videoHeight * scale;
          ctx.drawImage(video, 0, 0, copyCanvas.width, copyCanvas.height);
        } else {
          setIsLoading(false);
          return;
        }
      } else if (imageSrc) {
        const image = await loadImage(imageSrc);
        const scale = Math.min(maxSize / image.width, maxSize / image.height);
        copyCanvas.width = image.width * scale;
        copyCanvas.height = image.height * scale;
        ctx.drawImage(image, 0, 0, image.width * scale, image.height * scale);
      } else {
        // Should not happen with disabled button, but we'll see
        setIsLoading(false);
        return;
      }
      activeDataURL = copyCanvas.toDataURL('image/png');

      if (lines.length > 0) {
        for (const line of lines) {
          const p = new Path2D(
            getSvgPathFromStroke(
              getStroke(
                line[0].map(([x, y]) => [
                  x * copyCanvas.width,
                  y * copyCanvas.height,
                  0.5,
                ]),
                lineOptions,
              ),
            ),
          );
          ctx.fillStyle = line[1];
          ctx.fill(p);
        }
        activeDataURL = copyCanvas.toDataURL('image/png');
      }

      setHoverEntered(false);
      const config: {
        temperature: number;
        thinkingConfig?: {thinkingBudget: number};
        responseMimeType?: string;
      } = {
        temperature,
        responseMimeType: 'application/json',
      };

      if (!isThinkingEnabled) {
        config.thinkingConfig = {thinkingBudget: 0};
      } else {
        // High reasoning budget for models that support it
        config.thinkingConfig = {thinkingBudget: 4000};
      }
      const model = currentModel;

      let textPromptToSend = '';
      if (is2d) {
        textPromptToSend = get2dPrompt();
      } else {
        textPromptToSend = getGenericPrompt(detectType);
      }

      const requestPayload = {
        model,
        contents: {
          parts: [
            {
              inlineData: {
                data: activeDataURL.replace('data:image/png;base64,', ''),
                mimeType: 'image/png',
              },
            },
            {text: textPromptToSend},
          ],
        },
        config,
      };

      const displayPayload = JSON.parse(JSON.stringify(requestPayload));
      displayPayload.contents.parts[0].inlineData.data =
        '<BASE64_IMAGE_DATA_REDACTED>';
      setRequestJson(JSON.stringify(displayPayload, null, 2));

      let resData: {text?: string; error?: string; retry?: boolean} | null =
        null;
      const maxAttempts = 3;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const apiRes = await fetch('/api/gemini/generate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(requestPayload),
        });

        const rawText = await apiRes.text();
        const trimmedRaw = rawText.trim();
        const isHtmlResponse =
          trimmedRaw.toLowerCase().startsWith('<!doctype') ||
          trimmedRaw.toLowerCase().startsWith('<html') ||
          (apiRes.headers.get('content-type') || '').includes('text/html');

        if (isHtmlResponse || apiRes.redirected) {
          if (attempt < maxAttempts) {
            await new Promise((r) => setTimeout(r, 700 * attempt));
            continue;
          }
          throw new Error(
            'Server returned an HTML response instead of JSON. Please refresh the page and try again.',
          );
        }

        let parsedApiJson: any = {};
        try {
          parsedApiJson = trimmedRaw ? JSON.parse(trimmedRaw) : {};
        } catch {
          if (attempt < maxAttempts) {
            await new Promise((r) => setTimeout(r, 700 * attempt));
            continue;
          }
          throw new Error(
            `Invalid JSON response from server (status ${apiRes.status}).`,
          );
        }

        if (parsedApiJson?.retry && attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 400));
          continue;
        }

        if (!apiRes.ok) {
          throw new Error(
            parsedApiJson.error ||
              `Server responded with status ${apiRes.status}`,
          );
        }

        resData = parsedApiJson;
        break;
      }

      let response = resData?.text || '';

      if (response.includes('```json')) {
        response = response.split('```json')[1].split('```')[0];
      } else if (response.includes('```')) {
        response = response.split('```')[1].split('```')[0];
      }
      response = response.trim();

      let parsedResponse: any = null;
      try {
        parsedResponse = JSON.parse(response);
      } catch {
        const firstBracket = response.indexOf('[');
        const lastBracket = response.lastIndexOf(']');
        if (firstBracket !== -1 && lastBracket > firstBracket) {
          try {
            parsedResponse = JSON.parse(
              response.slice(firstBracket, lastBracket + 1),
            );
          } catch {
            parsedResponse = null;
          }
        }
      }

      if (parsedResponse !== null) {
        let displayParsed = parsedResponse;
        if (detectType === 'Ghost canvas' && Array.isArray(displayParsed)) {
          displayParsed = displayParsed.map((item) => {
            if (item.box_2d) {
              const [ymin, xmin, ymax, xmax] = item.box_2d;
              // Coordinates normalized to 1000 by the model
              const cx = (xmin + xmax) / 2;
              const cy = (ymin + ymax) / 2;

              // Add pyautogui command helper
              return {
                ...item,
                pyautogui: {
                  click: `pyautogui.click(int(${cx} * screen_width / 1000), int(${cy} * screen_height / 1000))`,
                  moveTo: `pyautogui.moveTo(int(${cx} * screen_width / 1000), int(${cy} * screen_height / 1000))`,
                  center_normalized: [cx, cy],
                },
              };
            }
            return item;
          });
        }
        setResponseJson(JSON.stringify(displayParsed, null, 2));
      } else {
        setResponseJson(response);
      }

      if (Array.isArray(parsedResponse)) {
        if (
          detectType === '2D bounding boxes' ||
          detectType === 'Ghost canvas'
        ) {
          const formattedBoxes = parsedResponse
            .filter((box: any) => Array.isArray(box?.box_2d))
            .map(
              (box: {
                box_2d: [number, number, number, number];
                label: string;
              }) => {
                const [ymin, xmin, ymax, xmax] = box.box_2d;
                return {
                  x: xmin / 1000,
                  y: ymin / 1000,
                  width: (xmax - xmin) / 1000,
                  height: (ymax - ymin) / 1000,
                  label: box.label,
                };
              },
            );
          setHoverEntered(false);
          setBoundingBoxes2D(formattedBoxes);
        } else if (detectType === 'Points') {
          const formattedPoints = parsedResponse
            .filter((point: any) => Array.isArray(point?.point))
            .map((point: {point: [number, number]; label: string}) => {
              return {
                point: {
                  x: point.point[1] / 1000,
                  y: point.point[0] / 1000,
                },
                label: point.label,
              };
            });
          setPoints(formattedPoints);
        } else if (detectType === 'Segmentation masks') {
          const formattedBoxes = parsedResponse
            .filter((box: any) => Array.isArray(box?.box_2d))
            .map(
              (box: {
                box_2d: [number, number, number, number];
                label: string;
                mask: string;
              }) => {
                const [ymin, xmin, ymax, xmax] = box.box_2d;
                return {
                  x: xmin / 1000,
                  y: ymin / 1000,
                  width: (xmax - xmin) / 1000,
                  height: (ymax - ymin) / 1000,
                  label: box.label,
                  imageData: box.mask,
                };
              },
            );
          setHoverEntered(false);
          // sort largest to smallest
          const sortedBoxes = formattedBoxes.sort(
            (a: any, b: any) => b.width * b.height - a.width * a.height,
          );
          setBoundingBoxMasks(sortedBoxes);
        }
      }
    } catch (error: any) {
      console.error('Error processing request:', error);
      setResponseJson(
        JSON.stringify(
          {
            error: 'An error occurred processing the response.',
            details: error?.message || String(error),
          },
          null,
          2,
        ),
      );
    } finally {
      const endTime = performance.now();
      const duration = ((endTime - startTime) / 1000).toFixed(2);
      setResponseTime(`Response time: ${duration}s`);
      setIsLoading(false);
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !isLoading) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex grow flex-col gap-3">
      <div className="flex justify-between items-center">
        <div className="uppercase flex items-center gap-2">
          Model:
          <select
            value={currentModel}
            onChange={(e) => {
              setSelectedModel(e.target.value);
            }}
            disabled={isLoading}
            className="bg-[var(--input-color)] border border-[var(--border-color)] rounded-md p-1 text-sm normal-case font-mono">
            <option value="gemini-3.7-flash">
              gemini-3.7-flash
            </option>
            <option value="gemini-3.8-flash">
              gemini-3.8-flash
            </option>
            <option value="gemini-3.1-pro-preview">
              gemini-3.1-pro
            </option>
            <option value="gemini-3.1-flash-lite">
              gemini-3.1-flash-lite
            </option>
            <option value="gemini-2.5-flash">
              gemini-2.5-flash
            </option>
            <option value="gemini-2.5-pro">
              gemini-2.5-pro
            </option>
            <option value="gemini-robotics-er-2-preview">
              gemini-robotics-er-2-preview
            </option>
            <option value="gemini-robotics-er-2.0-preview">
              gemini-robotics-er-2.0-preview
            </option>
            <option value="custom">Custom ID...</option>
          </select>
          {selectedModel === 'custom' && (
            <input
              type="text"
              className="bg-[var(--input-color)] border border-[var(--border-color)] rounded-md p-1 text-sm font-mono w-48"
              placeholder="Enter model ID"
              value={customModelId}
              onChange={(e) => {
                setCustomModelId(e.target.value);
                // In a real scenario we'd want to store this in an atom
              }}
              onBlur={() => {
                if (customModelId) {
                  setSelectedModel(customModelId);
                }
              }}
            />
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1 text-sm">
        <label className="flex items-center gap-2 select-none">
          <input
            type="checkbox"
            checked={isThinkingEnabled}
            onChange={(e) => setIsThinkingEnabled(e.target.checked)}
            disabled={isLoading}
          />
          Enable thinking
        </label>
        <div className="text-xs pl-6 text-[var(--text-color-secondary)]">
          Thinking improves the capabilities of the model to reason through
          tasks, but may produce less desirable results for simple locating
          tasks. For simple tasks, disable thinking for improved speed and
          likely better results.
        </div>
      </div>

      <div className="border-b my-1 border-[var(--border-color)]"></div>

      <div className="uppercase">Prompt</div>

      <div className="w-full flex flex-col">
        {is2d || detectType === 'Ghost canvas' ? (
          <div className="flex flex-col gap-2">
            <div>{detectType === 'Ghost canvas' ? prompts['Ghost canvas'][0] : 'Detect items:'}</div>
            <textarea
              className="w-full bg-[var(--input-color)] rounded-lg resize-none p-4"
              placeholder={detectType === 'Ghost canvas' ? "UI elements" : "e.g., cars, trees"}
              rows={1}
              value={detectType === 'Ghost canvas' ? prompts['Ghost canvas'][1] : targetPrompt}
              onChange={(e) => {
                if (detectType === 'Ghost canvas') {
                   const value = e.target.value;
                   const newPromptsState = {...prompts};
                   if (!newPromptsState[detectType])
                     newPromptsState[detectType] = ['', '', ''];
                   newPromptsState[detectType][1] = value;
                   setPrompts(newPromptsState);
                } else {
                  setTargetPrompt(e.target.value)
                }
              }}
              onKeyDown={handleKeyDown}
              disabled={isLoading}
            />
            {detectType === 'Ghost canvas' && (
              <div className="text-xs text-[var(--text-color-secondary)]">
                Note: This mode uses browser screen sharing. Click "Start Screen Capture" in the preview window first. For real desktop control, use the Python backend script.
              </div>
            )}
          </div>
        ) : detectType === 'Segmentation masks' ? (
          <div className="flex flex-col gap-2">
            <div>{prompts[detectType][0]}</div>
            <textarea
              className="w-full bg-[var(--input-color)] rounded-lg resize-none p-4"
              placeholder="What to segment?"
              rows={1}
              value={prompts[detectType][1]}
              onChange={(e) => {
                const value = e.target.value;
                const newPromptsState = {...prompts};
                if (!newPromptsState[detectType])
                  newPromptsState[detectType] = ['', '', ''];
                newPromptsState[detectType][1] = value;
                setPrompts(newPromptsState);
              }}
              onKeyDown={handleKeyDown}
              disabled={isLoading}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div>{prompts[detectType]?.[0]}</div>
            <textarea
              className="w-full bg-[var(--input-color)] rounded-lg resize-none p-4"
              placeholder="What kind of things do you want to detect?"
              rows={1}
              value={prompts[detectType]?.[1] ?? ''}
              onChange={(e) => {
                const value = e.target.value;
                const newPromptsState = {...prompts};
                if (!newPromptsState[detectType])
                  newPromptsState[detectType] = ['', '', ''];
                newPromptsState[detectType][1] = value;
                setPrompts(newPromptsState);
              }}
              onKeyDown={handleKeyDown}
              disabled={isLoading}
            />
          </div>
        )}
      </div>
      <div className="flex justify-between gap-3">
        <button
          className={`bg-[#3B68FF] px-12 !text-white !border-none flex items-center justify-center ${isLoading || (!imageSrc && detectType !== 'Ghost canvas') ? 'opacity-50 cursor-not-allowed' : ''}`}
          onClick={handleSend}
          disabled={isLoading || (!imageSrc && detectType !== 'Ghost canvas')}>
          {isLoading ? (
            <>
              <svg
                className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"></circle>
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Sending...
            </>
          ) : (
            'Send'
          )}
        </button>

        {detectType === 'Ghost canvas' && (
          <button
            className={`bg-[#22c55e] px-8 !text-white !border-none flex items-center justify-center ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
            onClick={handleRemoteSend}
            disabled={isLoading}>
            Remote Capture (Local)
          </button>
        )}

        <label className="flex items-center gap-2">
          temperature:
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={temperature}
            onChange={(e) => setTemperature(Number(e.target.value))}
            disabled={isLoading}
          />
          {temperature}
        </label>
      </div>
      {responseTime && (
        <div className="text-sm text-gray-500 mt-2">{responseTime}</div>
      )}
    </div>
  );
}
