import { DatabaseSync } from "node:sqlite";
import { createInterface } from "node:readline";
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import { ControlOverlay } from "./control-overlay";
import { chromeTabs, type ChromeTab } from "./chrome-tabs";

type ToolName = "chrome_tabs" | "chrome_select_tab" | "chrome_focus" | "chrome_scroll" | "chrome_drag" | "browser_tabs" | "browser_open" | "browser_snapshot" | "browser_screenshot" | "browser_reset" | "browser_click" | "browser_click_at" | "browser_hover" | "browser_drag" | "browser_type" | "browser_type_text" | "browser_press_key" | "browser_scroll" | "chrome_windows" | "chrome_snapshot" | "chrome_click" | "chrome_type" | "chrome_press_key" | "computer_apps" | "computer_launch_app" | "computer_windows" | "computer_snapshot" | "computer_click" | "computer_type" | "computer_press_key" | "computer_scroll";
const requested = new Set<string>((process.env.PIXELCREW_DEVICE_TOOLS || "").split(",").filter(Boolean));
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataRoot = resolve(process.env.PIXELCREW_DEVICE_DATA || join(root, ".data/device-control"));
const sessionId = /^[0-9a-f-]{36}$/i.test(process.env.PIXELCREW_DEVICE_SESSION_ID || "") ? process.env.PIXELCREW_DEVICE_SESSION_ID! : "";
const dbPath = resolve(process.env.PIXELCREW_DEVICE_DB || join(root, ".data/studio.sqlite"));
const profilePath = resolve(root, ".data/browser-profiles", sessionId || "disabled");
const pages = new Map<string, Page>();
const windows = new Map<number, { id: number; app: string; title?: string }>();
const availableApps = new Map<string, string>();
const observedChromeTabs = new Map<number, ChromeTab[]>();
let browserContext: BrowserContext | undefined;
let sky: any;
let heldLock: { fd: number; token: string; path: string } | undefined;
let closing = false;
let desktopOverlay: ControlOverlay | undefined;
let clientCapabilities: any = {};
let approvalSequence = 0;
const pendingAppApprovals = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
async function forwardNativeAppApproval(request: any) {
    if (!clientCapabilities.elicitation) throw new Error("Chrome app approval needs an MCP client with form elicitation support.");
    const id = `pixelcrew-app-${++approvalSequence}`;
    return await new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => { pendingAppApprovals.delete(id); reject(new Error("Chrome app approval timed out.")); }, 10 * 60 * 1000);
      pendingAppApprovals.set(id, { resolve, reject, timer });
      send({ jsonrpc: "2.0", id, method: "elicitation/create", params: {
        mode: "form", message: String(request.message || "Allow PixelCrew to use this app for the current task?").replace("Allow Codex", "Allow PixelCrew"),
        requestedSchema: { type: "object", properties: {} },
      } });
    });
}

function enabled(name: ToolName) {
  if (name.startsWith("browser_")) return requested.has("browser");
  if (name.startsWith("chrome_")) return requested.has("chrome");
  return requested.has("computer");
}

function globalPermission(name: ToolName) {
  if (name.startsWith("browser_")) return true;
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const row = db.prepare("SELECT value FROM settings WHERE key='preferences'").get() as { value?: string } | undefined;
      const prefs = row?.value ? JSON.parse(row.value) : {};
      return name.startsWith("chrome_") ? prefs.allowChrome === true : prefs.allowWindowsComputer === true;
    } finally { db.close(); }
  } catch { return false; }
}

function check(name: ToolName) {
  if (!enabled(name)) throw new Error(`The ${name.split("_")[0]} tool was not enabled for this chat.`);
  if (!globalPermission(name)) throw new Error(`This tool is blocked by Settings → General.`);
}

function chromePath() {
  const paths = [
    process.env.CHROME_PATH,
    process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, "Google/Chrome/Application/chrome.exe"),
    process.env["PROGRAMFILES(X86)"] && join(process.env["PROGRAMFILES(X86)"], "Google/Chrome/Application/chrome.exe"),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Google/Chrome/Application/chrome.exe"),
    process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, "Microsoft/Edge/Application/msedge.exe"),
    process.env["PROGRAMFILES(X86)"] && join(process.env["PROGRAMFILES(X86)"], "Microsoft/Edge/Application/msedge.exe"),
  ].filter((path): path is string => !!path);
  return paths.find(existsSync);
}

async function getBrowser() {
  if (browserContext) return browserContext;
  if (!sessionId) throw new Error("This chat has no isolated browser session ID. Start a new chat turn and try again.");
  const executablePath = chromePath();
  if (!executablePath) throw new Error("PixelCrew could not find Chrome or Edge. Install a Chromium browser or set CHROME_PATH, then restart PixelCrew.");
  mkdirSync(profilePath, { recursive: true });
  browserContext = await chromium.launchPersistentContext(profilePath, { executablePath, headless: false, viewport: { width: 1365, height: 900 }, args: ["--disable-features=Translate"] });
  browserContext.on("close", () => { browserContext = undefined; pages.clear(); });
  browserContext.on("page", page => { registerPage(page); });
  for (const page of browserContext.pages()) registerPage(page);
  if (!browserContext.pages().length) registerPage(await browserContext.newPage());
  return browserContext;
}

let pageSequence = 0;
const pageNames = new WeakMap<Page, string>();
function registerPage(page: Page) {
  if (pageNames.has(page)) return pageNames.get(page)!;
  const id = `tab-${++pageSequence}`;
  pageNames.set(page, id); pages.set(id, page);
  page.on("close", () => pages.delete(id));
  return id;
}
function getPage(id?: string) {
  const page = id ? pages.get(id) : [...pages.values()].at(-1);
  if (!page || page.isClosed()) throw new Error("Browser tab is no longer open. List tabs and choose an active tab.");
  return page;
}
async function installLivePointer(page: Page) {
  await page.evaluate(() => {
    const id = "pixelcrew-visual-pointer";
    let marker = document.getElementById(id);
    if (!marker) {
      marker = document.createElement("div");
      marker.id = id;
      marker.setAttribute("aria-hidden", "true");
      marker.style.cssText = "position:fixed;z-index:2147483647;width:22px;height:24px;pointer-events:none;transform:translate(-3px,-3px);filter:drop-shadow(0 0 3px #f4d99f) drop-shadow(0 0 8px #e8bc72)";
      marker.innerHTML = '<svg width="22" height="24" viewBox="0 0 22 24" xmlns="http://www.w3.org/2000/svg"><path d="M4 3 Q2 2 3 5 L7 20 Q8 22 9 19 L12 13 L18 10 Q21 9 18 8 Z" fill="#25251f" stroke="#fff1cf" stroke-width="1.8" stroke-linejoin="round"/></svg>';
      document.documentElement.append(marker);
      const shade = document.createElement("div");
      shade.id = "pixelcrew-control-shade";
      shade.setAttribute("aria-hidden", "true");
      shade.style.cssText = "position:fixed;inset:0;z-index:2147483646;pointer-events:none;background:rgba(0,0,0,.065);box-shadow:inset 0 0 0 3px #e8bc72,inset 0 0 48px rgba(232,188,114,.14)";
      document.documentElement.append(shade);
      let idle: ReturnType<typeof setTimeout>;
      window.addEventListener("mousemove", event => {
        marker!.style.left = `${event.clientX}px`;
        marker!.style.top = `${event.clientY}px`;
        marker!.style.visibility = shade.style.visibility = "visible";
        clearTimeout(idle);
        idle = setTimeout(() => { marker!.style.visibility = shade.style.visibility = "hidden"; }, 15000);
      }, { passive: true });
      idle = setTimeout(() => { marker!.style.visibility = shade.style.visibility = "hidden"; }, 15000);
    }
  });
}
async function movePointer(page: Page, x: number, y: number) {
  await installLivePointer(page);
  await page.mouse.move(x, y, { steps: 12 });
}
function validUrl(input: string) {
  const url = new URL(input);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
    throw new Error("Browser navigation is limited to HTTP and HTTPS URLs without embedded credentials.");
  return url.toString();
}

async function getSky() {
  if (sky) return sky;
  if (process.platform !== "win32") throw new Error("Windows Computer tools are available only on Windows.");
  const candidates: string[] = [];
  const runtimeRoot = process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "OpenAI/Codex/runtimes/cua_node");
  if (runtimeRoot && existsSync(runtimeRoot)) {
    for (const version of readdirSync(runtimeRoot))
      candidates.push(join(runtimeRoot, version, "bin/node_modules/@oai/sky/dist/project/cua/sky_js/src/index.js"));
  }
  for (const path of candidates.reverse()) if (existsSync(path)) {
    const pipeNames = readdirSync("\\\\.\\pipe\\").filter(name => /^codex-computer-use-[0-9a-f-]+$/i.test(name));
    if (!process.env.SKY_CUA_NATIVE_PIPE_DIRECTORY && pipeNames.length === 1)
      process.env.SKY_CUA_NATIVE_PIPE_DIRECTORY = `\\\\.\\pipe\\${pipeNames[0]}`;
    if (process.env.SKY_CUA_NATIVE_PIPE_DIRECTORY) process.env.SKY_CUA_NATIVE_PIPE = "1";
    const base = pathToFileURL(path);
    const [{ WindowsComputerUseClient }, { WindowsHelperTransport }, { package_bin }] = await Promise.all([
      import(new URL("./targets/windows/internal/computer_use_client.js", base).href),
      import(new URL("./targets/windows/internal/helper_transport.js", base).href),
      import(new URL("./core/package_bin.js", base).href),
    ]);
    // Use the installed runtime's transport and approval handling. No fabricated
    // app-grant metadata: the native runtime requests and validates real consent.
    const transport = new WindowsHelperTransport({
      helperCommand: package_bin({ relative_path: ["bin", "windows", process.arch === "arm64" ? "codex-computer-use-arm64.exe" : "codex-computer-use.exe"], env_var_override: "OAI_SKY_WINDOWS_BIN" }),
      helperArgs: ["--parent-pid", String(process.pid)],
      timeoutMs: 30000,
    });
    sky = new WindowsComputerUseClient({ transport: {
      request: (method: string, params: Record<string, unknown>, options: any = {}) =>
        transport.request(method, params, { ...options, createElicitation: forwardNativeAppApproval }),
      close: () => transport.close(),
    } });
    return sky;
  }
  throw new Error("Windows Computer runtime is unavailable. Install and connect Computer Use in the Codex desktop app, then restart PixelCrew.");
}

function pidAlive(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}
async function acquireDesktopLock() {
  if (heldLock) return;
  mkdirSync(dataRoot, { recursive: true });
  const lockPath = join(dataRoot, "shared-desktop.lock");
  const token = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  while (!closing) {
    try {
      const fd = openSync(lockPath, "wx");
      writeFileSync(fd, JSON.stringify({ pid: process.pid, sessionId, token, startedAt: new Date().toISOString() }));
      heldLock = { fd, token, path: lockPath };
      return;
    } catch {
      try {
        const saved = JSON.parse(readFileSync(lockPath, "utf8"));
        if (!pidAlive(Number(saved.pid))) unlinkSync(lockPath);
      } catch { /* another process may be creating or releasing the lock */ }
      await new Promise(resolve => setTimeout(resolve, 350));
    }
  }
  throw new Error("Waiting for shared Chrome/Windows access was cancelled because this task stopped.");
}
async function getWindow(id: number, chromeOnly: boolean) {
  const cached = windows.get(id);
  if (!cached) throw new Error("Choose a window returned by the latest Chrome/Windows window list.");
  if (chromeOnly && !/chrome|google chrome/i.test(`${cached.app} ${cached.title || ""}`))
    throw new Error("The selected window is not a Chrome window.");
  const client = await getSky();
  return client.get_window({ id, app: cached.app });
}

function tools(): any[] {
  const all: any[] = [
    ["browser_tabs", "List tabs in this chat's isolated browser.", { type: "object", properties: {} }, true],
    ["browser_open", "Open an HTTP or HTTPS URL in this chat's isolated browser.", { type: "object", properties: { url: { type: "string" } }, required: ["url"] }, false],
    ["browser_snapshot", "Read the visible text and URL of a browser tab.", { type: "object", properties: { tabId: { type: "string" } } }, true],
    ["browser_screenshot", "Capture a browser tab screenshot.", { type: "object", properties: { tabId: { type: "string" } } }, true],
    ["browser_reset", "Close this chat's isolated browser tabs and open a fresh blank tab. Requires approval.", { type: "object", properties: {} }, false],
    ["browser_click", "Click an element by CSS selector in a browser tab. Requires approval.", { type: "object", properties: { tabId: { type: "string" }, selector: { type: "string" } }, required: ["selector"] }, false],
    ["browser_click_at", "Click a point in the visible browser viewport using screenshot pixel coordinates. Requires approval.", { type: "object", properties: { tabId: { type: "string" }, x: { type: "number" }, y: { type: "number" } }, required: ["x", "y"] }, false],
    ["browser_hover", "Move the pointer to a point in the visible browser viewport. Requires approval.", { type: "object", properties: { tabId: { type: "string" }, x: { type: "number" }, y: { type: "number" } }, required: ["x", "y"] }, false],
    ["browser_drag", "Drag from one screenshot coordinate to another in the browser viewport. Requires approval.", { type: "object", properties: { tabId: { type: "string" }, fromX: { type: "number" }, fromY: { type: "number" }, toX: { type: "number" }, toY: { type: "number" } }, required: ["fromX", "fromY", "toX", "toY"] }, false],
    ["browser_type", "Type text into a browser element selected by CSS. Requires approval.", { type: "object", properties: { tabId: { type: "string" }, selector: { type: "string" }, text: { type: "string" } }, required: ["selector", "text"] }, false],
    ["browser_type_text", "Type text into the currently focused browser element. Requires approval.", { type: "object", properties: { tabId: { type: "string" }, text: { type: "string" } }, required: ["text"] }, false],
    ["browser_press_key", "Send a key to the focused browser tab. Requires approval.", { type: "object", properties: { tabId: { type: "string" }, key: { type: "string" } }, required: ["key"] }, false],
    ["browser_scroll", "Scroll the browser viewport at a screenshot coordinate. Requires approval.", { type: "object", properties: { tabId: { type: "string" }, x: { type: "number" }, y: { type: "number" }, scrollY: { type: "number" }, scrollX: { type: "number" } }, required: ["x", "y", "scrollY"] }, false],
    ["chrome_windows", "List visible windows in the user's existing Chrome session.", { type: "object", properties: {} }, true],
    ["chrome_focus", "Bring an existing Chrome window forward, including a minimized window. Requires approval. Returns a fresh screenshot and tab strip.", { type: "object", properties: { windowId: { type: "integer" } }, required: ["windowId"] }, false],
    ["chrome_tabs", "Read existing tabs from a Chrome window's native tab strip. Does not open a new browser or tab. Focus minimized windows with chrome_focus first.", { type: "object", properties: { windowId: { type: "integer" } }, required: ["windowId"] }, true],
    ["chrome_select_tab", "Select an existing Chrome tab by elementIndex returned by chrome_tabs. Requires approval. Returns the selected tab's fresh screenshot.", { type: "object", properties: { windowId: { type: "integer" }, elementIndex: { type: "integer" } }, required: ["windowId", "elementIndex"] }, false],
    ["chrome_scroll", "Scroll inside the selected existing Chrome tab. Requires approval. Returns a fresh screenshot.", { type: "object", properties: { windowId: { type: "integer" }, x: { type: "number" }, y: { type: "number" }, scrollX: { type: "number" }, scrollY: { type: "number" }, screenshotId: { type: "string" } }, required: ["windowId", "x", "y", "scrollY"] }, false],
    ["chrome_drag", "Drag between coordinates in the existing Chrome window. Requires approval. Returns a fresh screenshot.", { type: "object", properties: { windowId: { type: "integer" }, fromX: { type: "number" }, fromY: { type: "number" }, toX: { type: "number" }, toY: { type: "number" }, screenshotId: { type: "string" } }, required: ["windowId", "fromX", "fromY", "toX", "toY"] }, false],
    ["chrome_snapshot", "Read a screenshot and accessibility text from a Chrome window.", { type: "object", properties: { windowId: { type: "integer" } }, required: ["windowId"] }, true],
    ["chrome_click", "Click a coordinate in an existing Chrome window. Requires approval.", { type: "object", properties: { windowId: { type: "integer" }, x: { type: "number" }, y: { type: "number" }, screenshotId: { type: "string" } }, required: ["windowId", "x", "y"] }, false],
    ["chrome_type", "Type text into an existing Chrome window. Requires approval.", { type: "object", properties: { windowId: { type: "integer" }, text: { type: "string" } }, required: ["windowId", "text"] }, false],
    ["chrome_press_key", "Send a key to an existing Chrome window. Requires approval.", { type: "object", properties: { windowId: { type: "integer" }, key: { type: "string" } }, required: ["windowId", "key"] }, false],
    ["computer_apps", "List apps and their visible windows on Windows.", { type: "object", properties: {} }, true],
    ["computer_launch_app", "Launch an installed app returned by the latest app list. Requires approval.", { type: "object", properties: { appId: { type: "string" } }, required: ["appId"] }, false],
    ["computer_windows", "List visible Windows desktop windows.", { type: "object", properties: {} }, true],
    ["computer_snapshot", "Read accessibility text and capture a Windows window screenshot.", { type: "object", properties: { windowId: { type: "integer" } }, required: ["windowId"] }, true],
    ["computer_click", "Click a coordinate in a Windows app window. Requires approval.", { type: "object", properties: { windowId: { type: "integer" }, x: { type: "number" }, y: { type: "number" }, screenshotId: { type: "string" } }, required: ["windowId", "x", "y"] }, false],
    ["computer_type", "Type text into a Windows app window. Requires approval.", { type: "object", properties: { windowId: { type: "integer" }, text: { type: "string" } }, required: ["windowId", "text"] }, false],
    ["computer_press_key", "Send a key to a Windows app window. Requires approval.", { type: "object", properties: { windowId: { type: "integer" }, key: { type: "string" } }, required: ["windowId", "key"] }, false],
    ["computer_scroll", "Scroll a Windows app window. Requires approval.", { type: "object", properties: { windowId: { type: "integer" }, x: { type: "number" }, y: { type: "number" }, scrollX: { type: "number" }, scrollY: { type: "number" } }, required: ["windowId", "x", "y", "scrollY"] }, false],
  ];
  return all.filter(([name]) => enabled(name as ToolName)).map(([name, description, inputSchema, readOnlyHint]) => ({ name, description, inputSchema, annotations: { readOnlyHint, destructiveHint: false, openWorldHint: !readOnlyHint } }));
}

const textResult = (value: unknown) => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });
async function chromeState(client: any, window: any) {
  const state = await client.get_window_state({ window, include_screenshot: true, include_text: true });
  const tabs = chromeTabs(state.accessibility?.tree || "");
  observedChromeTabs.set(window.id, tabs);
  const content: any[] = [{ type: "text", text: JSON.stringify({ window: state.window, tabs, accessibility: state.accessibility,
    screenshots: (state.screenshots || []).map(({ url: _url, ...metadata }: any) => metadata),
    hint: tabs.length ? "Select an existing tab with chrome_select_tab using its elementIndex." : "No native tab entries exposed. Inspect the screenshot and use chrome_click on the visible tab strip.",
  }, null, 2).slice(0, 26000) }];
  for (const screenshot of state.screenshots || []) {
    if (!screenshot.url?.startsWith("data:image/")) continue;
    const mimeType = screenshot.url.slice(5, screenshot.url.indexOf(";"));
    const data = screenshot.url.slice(screenshot.url.indexOf(",") + 1);
    content.push({ type: "image", mimeType, data });
    const directory = join(dataRoot, "screenshots", sessionId);
    mkdirSync(directory, { recursive: true });
    const path = join(directory, `${Date.now()}-chrome-${window.id}-${content.length}.png`);
    writeFileSync(path, Buffer.from(data, "base64"));
    content.push({ type: "text", text: `Screenshot saved to ${path}. Return it using a Markdown image with forward slashes in the path.` });
  }
  return { content };
}
async function callTool(name: ToolName, args: any) {
  check(name);
  if (name.startsWith("browser_")) {
    const context = await getBrowser();
    if (name === "browser_tabs") return textResult(await Promise.all(context.pages().map(async page => ({ id: registerPage(page), title: await page.title(), url: page.url() }))));
    if (name === "browser_reset") {
      await Promise.all(context.pages().map(page => page.close()));
      const page = await context.newPage();
      return textResult({ id: registerPage(page), title: "", url: "about:blank" });
    }
    if (name === "browser_open") {
      const page = await context.newPage(); const id = registerPage(page);
      await page.goto(validUrl(String(args.url)), { waitUntil: "domcontentloaded", timeout: 30000 });
      return textResult({ id, title: await page.title(), url: page.url() });
    }
    const page = getPage(args.tabId);
    if (name === "browser_snapshot") return textResult({ title: await page.title(), url: page.url(), text: (await page.locator("body").innerText({ timeout: 10000 }).catch(() => "")).slice(0, 18000) });
    if (name === "browser_screenshot") {
      const bytes = await page.screenshot({ type: "png", fullPage: false });
      const directory = join(dataRoot, "screenshots", sessionId);
      mkdirSync(directory, { recursive: true });
      const path = join(directory, `${Date.now()}-${registerPage(page)}.png`);
      writeFileSync(path, bytes);
      return { content: [
        { type: "image", mimeType: "image/png", data: bytes.toString("base64") },
        { type: "text", text: `Screenshot saved to ${path}. Use this file path when returning the image to the user.` },
      ] };
    }
    if (name === "browser_click") {
      const locator = page.locator(String(args.selector).slice(0, 1000));
      const box = await locator.first().boundingBox({ timeout: 10000 });
      if (box) await movePointer(page, box.x + box.width / 2, box.y + box.height / 2);
      await locator.click({ timeout: 10000 }); return textResult("Clicked. The arrow pointer moves live with the browser interaction.");
    }
    if (name === "browser_click_at") { await movePointer(page, Number(args.x), Number(args.y)); await page.mouse.click(Number(args.x), Number(args.y)); return textResult("Clicked at the screenshot coordinates. The arrow pointer moves live in the browser window."); }
    if (name === "browser_hover") { await movePointer(page, Number(args.x), Number(args.y)); return textResult("Pointer moved live to the screenshot coordinates."); }
    if (name === "browser_drag") { await movePointer(page, Number(args.fromX), Number(args.fromY)); await page.mouse.down(); await page.mouse.move(Number(args.toX), Number(args.toY), { steps: 12 }); await page.mouse.up(); return textResult("Dragged between the screenshot coordinates with the arrow pointer moving live."); }
    if (name === "browser_type") {
      const locator = page.locator(String(args.selector).slice(0, 1000));
      const box = await locator.first().boundingBox({ timeout: 10000 });
      if (box) await movePointer(page, box.x + box.width / 2, box.y + box.height / 2);
      await locator.fill(String(args.text).slice(0, 10000), { timeout: 10000 }); return textResult("Text entered. The arrow pointer moves live with the browser interaction.");
    }
    if (name === "browser_type_text") { await page.keyboard.insertText(String(args.text).slice(0, 10000)); return textResult("Text entered into the focused element. Inspect the page."); }
    if (name === "browser_press_key") { await page.keyboard.press(String(args.key).slice(0, 80)); return textResult("Key sent."); }
    if (name === "browser_scroll") { await movePointer(page, Number(args.x), Number(args.y)); await page.mouse.wheel(Number(args.scrollX || 0), Number(args.scrollY)); return textResult("Scrolled at the screenshot coordinates with the arrow pointer moving live."); }
  }
  if (name.startsWith("chrome_") || name.startsWith("computer_")) {
    await acquireDesktopLock();
    const client = await getSky();
    if (name === "computer_apps") {
      const apps = await client.list_apps();
      windows.clear();
      availableApps.clear();
      for (const app of apps) {
        availableApps.set(String(app.id), String(app.id));
        if (app.displayName) availableApps.set(String(app.displayName), String(app.id));
        for (const window of app.windows || []) windows.set(window.id, { id: window.id, app: app.id, title: window.title });
      }
      return textResult(apps.map((app: any) => ({ id: app.id, name: app.displayName, windows: (app.windows || []).map((window: any) => ({ id: window.id, title: window.title })) })));
    }
    if (name === "computer_launch_app") {
      const appId = availableApps.get(String(args.appId));
      if (!appId) throw new Error("List installed apps first, then choose an app ID from that list.");
      await client.launch_app({ app: appId });
      return textResult(`Launched ${appId}. List windows to inspect it.`);
    }
    if (name === "computer_windows" || name === "chrome_windows") {
      const allWindows = name === "chrome_windows" ? (await client.list_apps()).filter((app: any) => /chrome|google chrome/i.test(`${app.id} ${app.displayName || ""}`)).flatMap((app: any) => (app.windows || []).map((window: any) => ({ ...window, app: app.id }))) : await client.list_windows();
      windows.clear();
      const visible = allWindows.filter((window: any) => !name.startsWith("chrome_") || /chrome|google chrome/i.test(`${window.app || ""} ${window.title || ""}`));
      for (const window of visible) windows.set(window.id, { id: window.id, app: window.app, title: window.title });
      if (name === "chrome_windows" && !visible.length) return textResult("No Chrome windows are available. Open Chrome and try again.");
      return textResult(visible);
    }
    const window = await getWindow(Number(args.windowId), name.startsWith("chrome_"));
    if (name === "chrome_tabs" || name === "chrome_snapshot") return chromeState(client, window);
    if (name === "chrome_select_tab") {
      const selected = observedChromeTabs.get(window.id)?.find(tab => tab.elementIndex === args.elementIndex);
      if (!selected) throw new Error("List Chrome tabs first and select an elementIndex from that list.");
      const current = await client.get_window_state({ window, include_screenshot: false, include_text: true });
      const match = chromeTabs(current.accessibility?.tree || "").find(tab => tab.elementIndex === args.elementIndex && tab.description === selected.description);
      observedChromeTabs.delete(window.id);
      if (!match) throw new Error("The tab strip changed. Read chrome_tabs again before selecting a tab.");
    }
    if (name.endsWith("_snapshot")) {
      const state = await client.get_window_state({ window, include_screenshot: true, include_text: true });
      const content: any[] = [{ type: "text", text: JSON.stringify({ window: state.window, accessibility: state.accessibility }, null, 2).slice(0, 18000) }];
      const screenshot = state.screenshots?.[0]?.url;
      if (typeof screenshot === "string" && screenshot.startsWith("data:image/")) content.push({ type: "image", mimeType: screenshot.slice(5, screenshot.indexOf(";")), data: screenshot.slice(screenshot.indexOf(",") + 1) });
      return { content };
    }
    await client.activate_window({ window });
    desktopOverlay ||= new ControlOverlay(dataRoot);
    await desktopOverlay.show(args.x === undefined ? undefined : Number(args.x), args.y === undefined ? undefined : Number(args.y));
    try {
    if (name.startsWith("chrome_")) {
      if (name === "chrome_select_tab") await client.click({ window, element_index: args.elementIndex });
      else if (name === "chrome_click") await client.click({ window, x: Number(args.x), y: Number(args.y), ...(args.screenshotId ? { screenshotId: args.screenshotId } : {}) });
      else if (name === "chrome_type") await client.type_text({ window, text: String(args.text).slice(0, 10000) });
      else if (name === "chrome_press_key") await client.press_key({ window, key: String(args.key).slice(0, 80) });
      else if (name === "chrome_scroll") await client.scroll({ window, x: Number(args.x), y: Number(args.y), scrollX: Number(args.scrollX || 0), scrollY: Number(args.scrollY), ...(args.screenshotId ? { screenshotId: args.screenshotId } : {}) });
      else if (name === "chrome_drag") await client.drag({ window, from_x: Number(args.fromX), from_y: Number(args.fromY), to_x: Number(args.toX), to_y: Number(args.toY), ...(args.screenshotId ? { screenshotId: args.screenshotId } : {}) });
      else if (name !== "chrome_focus") throw new Error(`Unsupported Chrome action: ${name}`);
      return await chromeState(client, window);
    }
    if (name.endsWith("_click")) { await client.click({ window, x: Number(args.x), y: Number(args.y) }); return textResult("Clicked. Inspect the current window before acting again."); }
    if (name.endsWith("_type")) { await client.type_text({ window, text: String(args.text).slice(0, 10000) }); return textResult("Text entered."); }
    if (name.endsWith("_press_key")) { await client.press_key({ window, key: String(args.key).slice(0, 80) }); return textResult("Key sent."); }
    if (name === "computer_scroll") { await client.scroll({ window, x: Number(args.x), y: Number(args.y), scrollX: Number(args.scrollX || 0), scrollY: Number(args.scrollY) }); return textResult("Scrolled. Inspect the current window."); }
    } catch (error) {
      desktopOverlay.hide();
      throw error;
    }
  }
  throw new Error(`Unsupported device tool: ${name}`);
}

function send(message: unknown) { process.stdout.write(`${JSON.stringify(message)}\n`); }
async function shutdown() {
  if (closing) return;
  closing = true;
  desktopOverlay?.close();
  try { await sky?.close(); } catch {}
  try { await browserContext?.close(); } catch {}
  if (heldLock) {
    try {
      const current = JSON.parse(readFileSync(heldLock.path, "utf8"));
      if (current.token === heldLock.token) unlinkSync(heldLock.path);
    } catch {}
    try { closeSync(heldLock.fd); } catch {}
    heldLock = undefined;
  }
}
process.on("SIGTERM", () => { void shutdown().finally(() => process.exit(0)); });
process.on("SIGINT", () => { void shutdown().finally(() => process.exit(0)); });
process.on("exit", () => {
  if (heldLock) { try { closeSync(heldLock.fd); unlinkSync(heldLock.path); } catch {} }
});

const rl = createInterface({ input: process.stdin });
rl.on("close", () => { void shutdown().finally(() => process.exit(0)); });
rl.on("line", line => {
  void (async () => {
    let request: any;
    try { request = JSON.parse(line); } catch { return; }
    const { id, method, params = {} } = request;
    if (!method && typeof id === "string" && pendingAppApprovals.has(id)) {
      const pending = pendingAppApprovals.get(id)!;
      pendingAppApprovals.delete(id); clearTimeout(pending.timer);
      if (request.error) pending.reject(new Error(request.error.message || "App approval failed."));
      else pending.resolve(request.result);
      return;
    }
    if (method === "notifications/initialized" || method?.startsWith("notifications/")) return;
    try {
      if (method === "initialize") {
        clientCapabilities = params.capabilities || {};
        return send({ jsonrpc: "2.0", id, result: { protocolVersion: params.protocolVersion || "2024-11-05", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "pixelcrew-device-tools", version: "0.1.0" } } });
      }
      if (method === "tools/list") return send({ jsonrpc: "2.0", id, result: { tools: tools() } });
      if (method === "tools/call") {
        const result = await callTool(params.name, params.arguments || {});
        return send({ jsonrpc: "2.0", id, result });
      }
      if (id !== undefined) send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unsupported method: ${method}` } });
    } catch (error) {
      if (id !== undefined) send({ jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text: String(error instanceof Error ? error.message : error) }] } });
    }
  })();
});
