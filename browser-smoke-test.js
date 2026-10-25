const fs = require("node:fs");
const path = require("node:path");

const cdpBase = process.env.CDP_BASE || "http://127.0.0.1:9222";
const appUrl = process.env.APP_URL || "http://127.0.0.1:4173";
const outputDir = path.join(__dirname, "artifacts");

fs.mkdirSync(outputDir, { recursive: true });

class CdpClient {
  constructor(webSocketUrl) {
    this.webSocketUrl = webSocketUrl;
    this.nextId = 1;
    this.pending = new Map();
    this.events = new Map();
  }

  async connect() {
    this.socket = new WebSocket(this.webSocketUrl);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const handler = this.pending.get(message.id);
        if (!handler) return;
        this.pending.delete(message.id);
        if (message.error) handler.reject(new Error(message.error.message));
        else handler.resolve(message.result);
        return;
      }
      const handlers = this.events.get(message.method) || [];
      handlers.forEach((handler) => handler(message.params));
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    const promise = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.socket.send(JSON.stringify({ id, method, params }));
    return promise;
  }

  once(method) {
    return new Promise((resolve) => {
      const handler = (params) => {
        const handlers = this.events.get(method) || [];
        this.events.set(
          method,
          handlers.filter((item) => item !== handler),
        );
        resolve(params);
      };
      const handlers = this.events.get(method) || [];
      this.events.set(method, [...handlers, handler]);
    });
  }

  close() {
    this.socket.close();
  }
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || "Evaluation failed");
  }
  return result.result.value;
}

async function screenshot(client, filename) {
  const result = await client.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  fs.writeFileSync(path.join(outputDir, filename), Buffer.from(result.data, "base64"));
}

async function wait(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function main() {
  const targetResponse = await fetch(`${cdpBase}/json/new?${encodeURIComponent(appUrl)}`, {
    method: "PUT",
  });
  if (!targetResponse.ok) throw new Error(`Cannot create target: ${targetResponse.status}`);
  const target = await targetResponse.json();
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();

  try {
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    const loaded = client.once("Page.loadEventFired");
    await client.send("Page.navigate", { url: appUrl });
    await loaded;
    await wait(500);

    const layout = await evaluate(
      client,
      `(() => {
        const width = window.innerWidth;
        const offenders = [...document.querySelectorAll('body *')]
          .map((node) => {
            const rect = node.getBoundingClientRect();
            return { tag: node.tagName, cls: String(node.className || '').slice(0, 80), left: rect.left, right: rect.right, width: rect.width };
          })
          .filter((item) => item.right > width + 1 || item.left < -1)
          .sort((a, b) => b.right - a.right)
          .slice(0, 20);
        return {
          innerWidth: width,
          bodyScrollWidth: document.body.scrollWidth,
          rootScrollWidth: document.documentElement.scrollWidth,
          offenders,
          title: document.title,
          hasToday: Boolean(document.querySelector('[data-view="today"].is-active')),
        };
      })()`,
    );
    console.log("LAYOUT", JSON.stringify(layout, null, 2));
    await screenshot(client, "today-390.png");

    const pwa = await evaluate(
      client,
      `(async () => {
        const registration = await Promise.race([
          navigator.serviceWorker.ready,
          new Promise((_, reject) => setTimeout(() => reject(new Error('service worker timeout')), 5000))
        ]);
        const manifest = await fetch('./manifest.webmanifest').then((response) => response.json());
        return {
          activeWorker: Boolean(registration.active),
          scope: registration.scope,
          display: manifest.display,
          startUrl: manifest.start_url
        };
      })()`,
    );
    console.log("PWA", JSON.stringify(pwa, null, 2));

    await evaluate(client, `document.querySelector('[data-view="progress"]').click()`);
    await wait(150);
    await screenshot(client, "progress-390.png");

    const merchantFlow = await evaluate(
      client,
      `(async () => {
        document.querySelector('[data-action="add-merchant"]').click();
        await new Promise((resolve) => setTimeout(resolve, 60));
        const form = document.querySelector('#sheetForm');
        form.querySelector('[name="name"]').value = '测试收纳店';
        form.querySelector('[name="product"]').value = '折叠收纳箱';
        form.querySelector('[name="stage"]').value = 'contacted';
        form.querySelector('[name="nextFollowUp"]').value = '2026-11-01';
        form.requestSubmit();
        await new Promise((resolve) => setTimeout(resolve, 100));
        const saved = JSON.parse(localStorage.getItem('jinri-yijin.state.v1'));
        return {
          merchantCount: saved.merchants.length,
          merchantName: saved.merchants[0]?.name,
          modalClosed: document.querySelector('#modalBackdrop').hidden,
          funnelHasTestStore: document.body.textContent.includes('测试收纳店'),
        };
      })()`,
    );
    console.log("MERCHANT", JSON.stringify(merchantFlow, null, 2));

    const captureFlow = await evaluate(
      client,
      `(async () => {
        document.querySelector('#openCapture').click();
        await new Promise((resolve) => setTimeout(resolve, 60));
        const form = document.querySelector('#sheetForm');
        form.querySelector('[name="content"]').value = '商家说完整广告比单片段更容易判断';
        form.querySelector('[name="source"]').value = '测试商家';
        form.requestSubmit();
        await new Promise((resolve) => setTimeout(resolve, 100));
        const saved = JSON.parse(localStorage.getItem('jinri-yijin.state.v1'));
        return {
          noteCount: saved.notes.length,
          note: saved.notes[0]?.content,
        };
      })()`,
    );
    console.log("CAPTURE", JSON.stringify(captureFlow, null, 2));

    await evaluate(client, `document.querySelector('[data-view="notes"]').click()`);
    await wait(150);
    await screenshot(client, "notes-390.png");

    await evaluate(client, `document.querySelector('[data-view="review"]').click()`);
    await wait(150);
    const reviewFlow = await evaluate(
      client,
      `(async () => {
        const form = document.querySelector('#reviewForm');
        form.querySelector('[name="output"]').value = '完成一条完整广告并联系商家';
        form.querySelector('[name="blocker"]').value = '商品一致性仍需验证';
        form.querySelector('[name="next"]').value = '继续联系 10 个商家';
        form.requestSubmit();
        await new Promise((resolve) => setTimeout(resolve, 100));
        const saved = JSON.parse(localStorage.getItem('jinri-yijin.state.v1'));
        return {
          reviewCount: Object.keys(saved.reviews).length,
          output: Object.values(saved.reviews)[0]?.output,
          modalClosed: document.querySelector('#modalBackdrop').hidden,
        };
      })()`,
    );
    console.log("REVIEW", JSON.stringify(reviewFlow, null, 2));
    await screenshot(client, "review-390.png");

    const focusFlow = await evaluate(
      client,
      `(async () => {
        document.querySelector('[data-view="today"]').click();
        await new Promise((resolve) => setTimeout(resolve, 80));
        document.querySelector('[data-action="start-focus"]').click();
        await new Promise((resolve) => setTimeout(resolve, 80));
        const timerVisible = Boolean(document.querySelector('[data-timer]'));
        document.querySelector('[data-action="end-focus"]').click();
        await new Promise((resolve) => setTimeout(resolve, 80));
        const saved = JSON.parse(localStorage.getItem('jinri-yijin.state.v1'));
        return {
          timerVisible,
          focusCount: saved.focusSessions.length,
          latestFocusMinutes: saved.focusSessions.at(-1)?.minutes,
          timerClosed: !saved.focusSession,
        };
      })()`,
    );
    console.log("FOCUS", JSON.stringify(focusFlow, null, 2));

    const taskCaptureFlow = await evaluate(
      client,
      `(async () => {
        document.querySelector('#openCapture').click();
        await new Promise((resolve) => setTimeout(resolve, 50));
        document.querySelector('[data-sheet-action="capture-type"][data-type="task"]').click();
        await new Promise((resolve) => setTimeout(resolve, 50));
        const form = document.querySelector('#sheetForm');
        form.querySelector('[name="content"]').value = '测试：联系第 2 个收纳商家';
        form.requestSubmit();
        await new Promise((resolve) => setTimeout(resolve, 80));
        const saved = JSON.parse(localStorage.getItem('jinri-yijin.state.v1'));
        return {
          newestTask: saved.actions[0]?.title,
          actionVisible: document.body.textContent.includes('测试：联系第 2 个收纳商家'),
        };
      })()`,
    );
    console.log("TASK_CAPTURE", JSON.stringify(taskCaptureFlow, null, 2));

    const settingsFlow = await evaluate(
      client,
      `(async () => {
        document.querySelector('#openSettings').click();
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {
          modalOpen: !document.querySelector('#modalBackdrop').hidden,
          hasExport: Boolean(document.querySelector('[data-sheet-action="export"]')),
          hasImport: Boolean(document.querySelector('[data-sheet-action="import"]')),
          focusMinutes: document.querySelector('[name="focusMinutes"]')?.value,
        };
      })()`,
    );
    console.log("SETTINGS", JSON.stringify(settingsFlow, null, 2));
    await evaluate(client, `document.querySelector('#closeModal').click()`);

    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 320,
      height: 720,
      deviceScaleFactor: 1,
      mobile: true,
    });
    const narrowLayouts = {};
    for (const view of ["today", "progress", "notes", "review"]) {
      await evaluate(client, `document.querySelector('[data-view="${view}"]').click()`);
      await wait(80);
      narrowLayouts[view] = await evaluate(
        client,
        `({
          innerWidth: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          overflow: document.documentElement.scrollWidth > window.innerWidth + 1
        })`,
      );
    }
    console.log("NARROW_LAYOUT", JSON.stringify(narrowLayouts, null, 2));
    await evaluate(client, `document.querySelector('[data-view="today"]').click()`);
    await wait(80);
    await screenshot(client, "today-320.png");
  } finally {
    client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
