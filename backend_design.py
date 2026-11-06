import os
import time
import json
import base64
from io import BytesIO
from PIL import ImageGrab, Image
import pyautogui
import google.generativeai as genai
from flask import Flask, request, jsonify
from flask_cors import CORS

# --- Configuration ---
# Set your API key here or in environment variables
API_KEY = os.getenv("GEMINI_API_KEY")
if not API_KEY:
    print("Warning: GEMINI_API_KEY not found in environment variables.")

# Configure Gemini
genai.configure(api_key=API_KEY)

# Initialize Flask app
app = Flask(__name__)
CORS(app)  # Enable CORS for local development

# --- Helper Functions ---

def capture_screen(region=None):
    """
    Captures the screen or a specific region.
    region: tuple (left, top, width, height) or None for full screen.
    Returns: PIL Image object
    """
    if region:
        # pyautogui takes (left, top, width, height)
        # ImageGrab takes (left, top, right, bottom)
        bbox = (region[0], region[1], region[0] + region[2], region[1] + region[3])
        return ImageGrab.grab(bbox=bbox)
    return ImageGrab.grab()

def get_gemini_response(image, prompt, model_name="gemini-3.7-flash"):
    """
    Sends the image and prompt to Gemini.
    """
    model = genai.GenerativeModel(model_name)
    
    # Convert image to bytes
    img_byte_arr = BytesIO()
    image.save(img_byte_arr, format='PNG')
    img_byte_arr = img_byte_arr.getvalue()

    response = model.generate_content([
        {'mime_type': 'image/png', 'data': img_byte_arr},
        prompt
    ])
    
    return response.text

def parse_response(response_text):
    """
    Parses the JSON response from Gemini.
    Expected format: JSON list of objects with "box_2d" and "label".
    """
    try:
        # Clean up markdown code blocks if present
        text = response_text.strip()
        if text.startswith("```json"):
            text = text[7:]
        if text.endswith("```"):
            text = text[:-3]
        
        return json.loads(text)
    except json.JSONDecodeError:
        print("Error parsing JSON response")
        return []

def map_coordinates(normalized_box, screen_region=None):
    """
    Maps normalized coordinates (0-1000) to absolute screen coordinates.
    normalized_box: [ymin, xmin, ymax, xmax]
    screen_region: (left, top, width, height) of the captured area.
    """
    ymin, xmin, ymax, xmax = normalized_box
    
    if screen_region:
        left, top, width, height = screen_region
    else:
        left, top = 0, 0
        width, height = pyautogui.size()

    # Calculate absolute pixel coordinates
    abs_xmin = left + (xmin / 1000 * width)
    abs_xmax = left + (xmax / 1000 * width)
    abs_ymin = top + (ymin / 1000 * height)
    abs_ymax = top + (ymax / 1000 * height)

    # Calculate center point
    center_x = (abs_xmin + abs_xmax) / 2
    center_y = (abs_ymin + abs_ymax) / 2

    return {
        "box": [abs_ymin, abs_xmin, abs_ymax, abs_xmax],
        "center": (center_x, center_y)
    }

# --- API Endpoints ---

@app.route('/detect', methods=['POST'])
def detect_ui():
    """
    Endpoint to trigger detection.
    Expects JSON body: { "prompt": "...", "region": [x, y, w, h] (optional) }
    """
    data = request.json
    prompt_text = data.get('prompt', 'Detect UI elements.')
    region = data.get('region') # Optional: specific window region

    # 1. Capture Screen
    print("Capturing screen...")
    screenshot = capture_screen(region)
    
    # 2. Send to Gemini
    print(f"Sending to Gemini with prompt: {prompt_text}")
    full_prompt = f"""
    {prompt_text}
    Return a JSON list where each entry contains the 2D bounding box in "box_2d" (ymin, xmin, ymax, xmax) and a text label in "label".
    Normalize coordinates to 0-1000.
    """
    response_text = get_gemini_response(screenshot, full_prompt)
    
    # 3. Parse Response
    detections = parse_response(response_text)
    
    # 4. Map Coordinates
    results = []
    for item in detections:
        if "box_2d" in item:
            coords = map_coordinates(item["box_2d"], region)
            results.append({
                "label": item.get("label"),
                "center": coords["center"], # (x, y) absolute
                "box": coords["box"],       # [ymin, xmin, ymax, xmax] absolute
                "pyautogui_code": f"pyautogui.click({int(coords['center'][0])}, {int(coords['center'][1])})"
            })

    return jsonify({"detections": results, "raw_response": response_text})

@app.route('/execute', methods=['POST'])
def execute_action():
    """
    Endpoint to execute an action (e.g. click) based on coordinates.
    Expects JSON body: { "x": 100, "y": 200, "action": "click" }
    """
    data = request.json
    x = data.get('x')
    y = data.get('y')
    action = data.get('action', 'click')

    if x is not None and y is not None:
        if action == 'click':
            pyautogui.click(x, y)
        elif action == 'moveTo':
            pyautogui.moveTo(x, y)
        # Add more actions as needed
        return jsonify({"status": "success", "message": f"Executed {action} at ({x}, {y})"})
    
    return jsonify({"status": "error", "message": "Missing coordinates"}), 400

# --- Main ---

if __name__ == '__main__':
    print("Starting Python Backend for Ghost Canvas...")
    print("Ensure you have installed requirements: pip install flask flask-cors pyautogui google-generativeai pillow")
    app.run(port=5000)
