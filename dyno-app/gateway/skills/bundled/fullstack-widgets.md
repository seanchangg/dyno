---
id: fullstack-widgets
name: Full-Stack Widget Authoring
description: Patterns for building widgets with interactive frontends backed by server-side scripts
version: 1.1.0
author: Marty
tags: [widgets, fullstack, execution, html]
---

# Full-Stack Widgets

Build interactive HTML widgets with server-side computation by combining `save_script` (backend) + `write_file` (frontend HTML) + `ui_action` (dashboard placement).

## Plan → Build Workflow

Custom widgets are complex — always use a plan-first approach:

1. **Plan**: Describe what you'll build — the backend script(s), the frontend HTML, how they connect, and what data flows between them. Present this to the user as a short summary before writing any code.
2. **User adjusts**: Let the user approve, modify scope, or simplify before you build. This avoids wasted work on expensive widget builds.
3. **Build with Opus**: Spawn an opus child agent to do the actual implementation. Widget code requires careful HTML/CSS/JS + backend integration — opus handles this significantly better.

```
spawn_agent model=opus, task="Build a full-stack widget: [description]. Follow the fullstack-widgets skill pattern. Save backend script with save_script, write HTML to workspace/widgets/[name].html, then add to dashboard with ui_action. IMPORTANT: You are a child agent — you do NOT have spawn_agent. Build everything yourself directly using save_script, write_file, and ui_action. Do NOT attempt to delegate or spawn sub-agents."
```

Always delegate widget creation to an opus child agent — do NOT attempt to build widgets yourself on sonnet. The quality difference is substantial for frontend code.

**Important:** Include the "you are a child agent" instruction in the spawn prompt. Opus is smart enough to read the fullstack-widgets skill and try to follow the "spawn opus" instruction recursively. It must know it IS the opus child and should build directly.

## How It Works

There are separate Supabase Storage buckets for different data types. You don't interact with buckets directly — the tools and API routes handle this for you:

- **`save_script`** → saves to the **scripts** bucket (for backend execution via `run_script`)
- **`write_file workspace/widgets/foo.html`** → saves to the **workspace** bucket (for widget HTML)
- **`/api/widget-html/foo.html`** → Next.js route that serves widget HTML (checks both workspace and widgets buckets automatically)
- **`/api/widget-exec`** → Next.js route that runs a saved script with JSON input (same-origin, callable from widget iframes)

The iframe is served from the same origin as the app, so `fetch('/api/widget-exec')` just works.

```
write_file workspace/widgets/foo.html → Supabase "workspace" bucket
                                              ↓
               /api/widget-html/foo.html (Next.js serves it as same-origin HTML)
                                              ↓
                          <iframe src="/api/widget-html/foo.html">
                            fetch('/api/widget-exec', {script, input})
                                              ↓
                          /api/widget-exec → Gateway → run_script with stdin_data
                                              ↓
                          Script reads stdin JSON → prints JSON to stdout → response
```

## The 3-Step Pattern

### Step 1: Save the backend script

Use `save_script`. The script reads JSON from **stdin** and prints JSON to **stdout**.

**Python** (recommended):
```python
import sys, json
data = json.load(sys.stdin)
result = {"greeting": f"Hello, {data['name']}!"}
print(json.dumps(result))
```

**JavaScript:**
```javascript
const chunks = [];
process.stdin.on('data', c => chunks.push(c));
process.stdin.on('end', () => {
  const data = JSON.parse(Buffer.concat(chunks).toString());
  console.log(JSON.stringify({ greeting: `Hello, ${data.name}!` }));
});
```

**Bash:**
```bash
INPUT=$(cat)
NAME=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['name'])")
echo "{\"greeting\": \"Hello, $NAME!\"}"
```

**C++:**
```cpp
#include <iostream>
#include <string>
int main() {
    std::string input((std::istreambuf_iterator<char>(std::cin)),
                       std::istreambuf_iterator<char>());
    // Parse and process input...
    std::cout << "{\"result\": 42}" << std::endl;
    return 0;
}
```

Example:
```
save_script name=my-backend, language=python, description="Backend for my widget", code="import sys,json\ndata=json.load(sys.stdin)\nprint(json.dumps({'echo': data}))"
```

### Step 2: Write the widget HTML

Use `write_file` to save HTML to **`workspace/widgets/my-widget.html`**. This is the required path — the widget serving route looks here.

The HTML can call `/api/widget-exec` to run backend scripts. The platform automatically injects `window.__DYNO_USER_ID` into the served HTML — always include it in your fetch calls.

**The `/api/widget-exec` endpoint expects this exact JSON body format:**
```json
{ "script": "my-backend", "input": { ... }, "userId": "..." }
```
The field MUST be called `script` (not `name`, `scriptName`, or `script_name`) — this is the name you used in `save_script`.

```html
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: sans-serif; padding: 16px; color: #E0E6E1; background: #121A14; }
    .error { color: #ff6b6b; }
  </style>
</head>
<body>
  <div id="app">Loading...</div>
  <script>
    async function callBackend(script, input) {
      const res = await fetch('/api/widget-exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          script,
          input,
          userId: window.__DYNO_USER_ID || ''
        })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.stderr || 'Script failed');
      return JSON.parse(data.stdout);
    }

    async function init() {
      try {
        const result = await callBackend('my-backend', { name: 'World' });
        document.getElementById('app').textContent = result.greeting;
      } catch (err) {
        document.getElementById('app').innerHTML =
          '<span class="error">' + err.message + '</span>';
      }
    }

    init();
  </script>
</body>
</html>
```

**Important rules for widget HTML:**
- **Always include `userId: window.__DYNO_USER_ID`** in widget-exec fetch calls — this is injected by the platform and required for cloud mode
- Use **relative URLs** (`/api/widget-exec`, not `http://localhost:3000/api/widget-exec`)
- Do NOT write to Supabase buckets directly — use `write_file` which handles routing
- Do NOT create new buckets — the infrastructure handles this
- The widget iframe is same-origin with the app, so `/api/` calls work

### Step 3: Add the widget to the dashboard

Use `ui_action` with `src` pointing to the **widget-html API route** (not a raw file path or Supabase URL):

```
ui_action action=add, type=html, props={ src: "/api/widget-html/my-widget.html" }, w=4, h=4
```

**Critical:** The `src` must be `/api/widget-html/FILENAME.html` — this is the Next.js route that serves the HTML from storage. The userId is automatically injected by the frontend. Do NOT use:
- Raw Supabase URLs (won't work, wrong origin)
- localhost URLs (won't work in production)
- Direct file paths (not how the serving works)

## Supported Languages

| Language   | stdin pattern | Notes |
|------------|--------------|-------|
| Python     | `json.load(sys.stdin)` | Recommended for data processing |
| JavaScript | `process.stdin` events | Good for JSON-heavy work |
| TypeScript | `process.stdin` events | Same as JS, with types |
| Bash       | `cat` / `read` | Use python3 for JSON parsing |
| C++        | `std::cin` | Compiled with g++ -std=c++17 |

## Execution Environment Constraints

Scripts run in an isolated Docker container with a set of pre-installed packages including:
`requests`, `httpx`, `beautifulsoup4`, `pandas`, `numpy`, `matplotlib`, `Pillow`, `qrcode`,
`gTTS`, `PyPDF2`, `reportlab`, `python-docx`, `openpyxl`, `pyyaml`, `jinja2`, `cryptography`,
and more (see `python/sandbox/requirements-sandbox.txt` for the full list).

Each execution is a fresh container — packages installed at runtime via `pip install` are lost
when execution ends. Do NOT pip install packages and expect them in later calls. Only use the
pre-installed packages.

For HTTP requests in Python scripts, `requests` and `httpx` are available:
```python
import requests, json
r = requests.get(url)
data = r.json()
```

## Live Updates (Polling)

Widgets can auto-refresh by polling the backend with `setInterval`:

```javascript
async function refresh() {
  try {
    const data = await callBackend('my-script', { action: 'latest' });
    render(data);
  } catch (err) {
    console.error('Refresh failed:', err);
  }
}

// Initial load + poll every 10 seconds
refresh();
setInterval(refresh, 10000);
```

Use this for dashboards, live feeds, or any widget that should stay current without user interaction.

## Common Mistakes

- **Saving JSON state/data files to widget-html**: The `/api/widget-html/` endpoint ONLY serves `.html` files — it returns 400 for everything else. Do NOT write JSON files to `workspace/widgets/`. JSON state files, config files, and other non-HTML data must go in **`workspace/data/`** (e.g. `workspace/data/my-widget-state.json`). Use `write_file` and `read_file` with `workspace/data/` paths for any persistent data your widgets need.
- **pip installing at runtime**: Each execution is a fresh Docker container. `pip install` works but is lost immediately. Only pre-installed packages persist (pandas, numpy, matplotlib, etc. — see requirements-sandbox.txt). Do NOT pip install in execute_code and expect it in a widget backend script.
- **Writing HTML to wrong path**: Must be `workspace/widgets/filename.html`, not just `workspace/filename.html`
- **Using absolute URLs**: Always use relative `/api/` URLs in widget HTML
- **Using srcDoc**: Only `src` mode iframes get `allow-same-origin`, which is required for fetch()
- **Creating Supabase buckets**: Don't — the buckets already exist and are managed by the platform
- **Hardcoding userId in HTML**: The widget-exec proxy handles userId injection automatically
- **Using wrong field name for script**: The fetch body must use `script` (not `name`, `scriptName`, or `script_name`). Copy the `callBackend` helper from the template above exactly.
- **Child agent trying to spawn sub-agents**: Opus child agents do NOT have `spawn_agent`. Always include "you are a child agent, build everything directly" in the spawn prompt.
- **Using `/api/run-script` instead of `/api/widget-exec`**: There is NO `/api/run-script` endpoint. The `run_script` tool is for agent-side execution only. Widget HTML must always fetch `/api/widget-exec` to run saved scripts.
