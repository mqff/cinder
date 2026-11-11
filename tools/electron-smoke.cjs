const { app, ipcMain, nativeTheme } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = process.env.CINDER_SMOKE_ROOT;
if (!root) throw new Error("Run npm run smoke");
app.setPath("userData", path.join(root, "app-data"));
app.setName("Cinder Smoke");
nativeTheme.themeSource = "dark";
const errors = [];
app.on("browser-window-created", (_event, window) => {
  window.webContents.setBackgroundThrottling(false);
  let quota = require("../test/limits-fixture.cjs").limitsFixture();
  const resetRequests = [];
  let delayedQuota = false;
  for (const channel of ["limits:read", "limits:refresh", "limits:reset", "limits:profiles", "accounts:cursor-usage"])
    ipcMain.removeHandler(channel);
  ipcMain.handle("limits:read", () => quota);
  ipcMain.handle("limits:refresh", async () => {
    if (delayedQuota) await new Promise((resolve) => setTimeout(resolve, 200));
    quota = { ...quota, checkedAt: new Date().toISOString() };
    return quota;
  });
  ipcMain.handle("limits:profiles", () => []);
  ipcMain.handle("accounts:cursor-usage", (_event, input) => {
    assert.equal(input.accountId, "d".repeat(24));
    return require("../test/limits-fixture.cjs").cursorUsageFixture(input.days);
  });
  ipcMain.handle("limits:reset", (_event, input) => {
    resetRequests.push(input);
    if (resetRequests.length === 1)
      return new Promise((resolve) =>
        setTimeout(() => resolve({ error: "Synthetic interruption; retry this reset." }), 200)
      );
    assert.equal(input.requestId, resetRequests[0].requestId);
    quota = {
      ...quota,
      accounts: quota.accounts.map((item) =>
        item.id === input.accountId
          ? {
              ...item,
              resetCredits: { available: 1, canUse: true },
              ordinaryUsageAllowed: true,
              windows: item.windows.map((row) => ({ ...row, usedPercent: 0 }))
            }
          : item
      )
    };
    return quota;
  });
  window.webContents.on("console-message", (details) => {
    if (details.level === "error") errors.push(details.message);
  });
  window.webContents.once("did-finish-load", async () => {
    const evaluate = (code) => window.webContents.executeJavaScript(code, true);
    async function waitFor(code, timeout = 20000) {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        if (await evaluate(code)) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error("Timed out: " + code);
    }
    function key(keyCode, modifiers = []) {
      window.focus();
      const code = keyCode.startsWith("Arrow") ? keyCode.slice(5) : keyCode;
      window.webContents.sendInputEvent({ type: "keyDown", keyCode: code, modifiers });
      window.webContents.sendInputEvent({ type: "keyUp", keyCode: code, modifiers });
    }
    async function openChoice(label, query) {
      await evaluate(`document.querySelector('.choice-trigger[aria-label=${JSON.stringify(label)}]').click()`);
      await waitFor(`document.activeElement.matches('.choice-search input')`);
      await evaluate(`new Promise(resolve => requestAnimationFrame(resolve))`);
      if (query) await window.webContents.insertText(query);
    }
    async function pickChoice(label, value, query) {
      await openChoice(label, query);
      await waitFor(`!!document.querySelector('.choice-option[data-value=${JSON.stringify(value)}]')`);
      await evaluate(`document.querySelector('.choice-option[data-value=${JSON.stringify(value)}]').click()`);
      await waitFor(`!document.querySelector('.choice-popup')`);
    }
    try {
      await waitFor(`document.querySelector('.stats-grid') && !document.querySelector('.scan-progress')`);
      await waitFor(`document.querySelector('.brand-mark')?.naturalWidth > 0`);
      window.webContents.setZoomFactor(0.75);
      await waitFor(`innerWidth >= 1200`);
      const probe = "cinder-smoke-console-probe";
      const observedProbe = new Promise((resolve) => {
        const listener = (event) => {
          if (event.message !== probe) return;
          window.webContents.removeListener("console-message", listener);
          resolve();
        };
        window.webContents.on("console-message", listener);
      });
      await evaluate(`console.error(${JSON.stringify(probe)})`);
      await Promise.race([
        observedProbe,
        new Promise((_, reject) => setTimeout(() => reject(new Error("Console capture failed")), 5000))
      ]);
      assert.ok(errors.includes(probe));
      errors.splice(errors.indexOf(probe), 1);
      await waitFor(`document.querySelector('.page-actions time')`);
      const info = await evaluate(`window.cinder.snapshotInfo()`);
      await waitFor(`window.cinder.snapshotCalls().then(value => !!value)`);
      const claudeCalls = await evaluate(`window.cinder.snapshotCalls().then(value => value?.sources.claude.total)`);
      assert.equal(info.sources, 19);
      const dimensions = await evaluate(
        `({ width: innerWidth, height: innerHeight, scroll: document.documentElement.scrollWidth })`
      );
      assert.equal(dimensions.width, dimensions.scroll);
      const requestsBefore = await evaluate(
        `Number(document.querySelector('.summary-stats .stat strong').textContent.replaceAll(',', ''))`
      );
      fs.appendFileSync(
        path.join(root, "claude", "projects", "app", "history.jsonl"),
        JSON.stringify({
          timestamp: new Date().toISOString(),
          cwd: "/work/app",
          sessionId: "fresh-request",
          message: {
            id: "fresh-request",
            model: "claude-sonnet-4-20250514",
            usage: { input_tokens: 2, output_tokens: 1 }
          }
        }) + "\n"
      );
      await evaluate(`document.querySelector('.refresh-button').click()`);
      await waitFor(
        `!document.querySelector('.refresh-button').disabled && Number(document.querySelector('.summary-stats .stat strong').textContent.replaceAll(',', '')) === ${requestsBefore + 1}`
      );
      assert.equal(await evaluate(`document.querySelectorAll('.provider-total').length`), 5);
      await evaluate(`document.querySelector('.provider-totals .list-more').click()`);
      await pickChoice("Providers", "hermes", "herm");
      await waitFor(`document.querySelectorAll('.provider-total').length === 1`);
      assert.equal(
        await evaluate(`document.querySelector('.model-meter i').style.width`),
        "100%",
        "sub-dollar model bar must use its actual maximum"
      );
      await pickChoice("Providers", "");
      await waitFor(`document.querySelector('.provider-totals .list-collapse')`);
      await waitFor(`document.querySelectorAll('.provider-total').length === 19`);
      await evaluate(`document.querySelector('.provider-totals .list-collapse').click()`);
      await evaluate(`document.querySelectorAll('.metric-tabs button')[1].click()`);
      await waitFor(`document.querySelector('.total-label').textContent === 'Processed tokens'`);
      await evaluate(`document.querySelectorAll('.metric-tabs button')[0].click()`);
      assert.equal(await evaluate(`!!document.querySelector('.workspace-footer, .local-status')`), false);
      const downloaded = new Promise((resolve, reject) => {
        window.webContents.session.once("will-download", (_event, item) => {
          const destination = path.join(root, "usage.csv");
          item.setSavePath(destination);
          item.once("done", (_event, state) => {
            if (state !== "completed") return reject(new Error(`CSV download: ${state}`));
            const csv = fs.readFileSync(destination, "utf8");
            if (!csv.includes("source,model,provider,project,session") || !csv.includes("claude")) {
              return reject(new Error("CSV is missing expected usage records"));
            }
            resolve();
          });
        });
      });
      await evaluate(`document.querySelector('.page-actions .button').click()`);
      await Promise.race([
        downloaded,
        new Promise((_, reject) => setTimeout(() => reject(new Error("CSV download timeout")), 5000))
      ]);
      const large = process.env.CINDER_SMOKE_LARGE === "1";
      const output = path.resolve(__dirname, "..", "artifacts", large ? "stress" : ".");
      fs.mkdirSync(output, { recursive: true });
      async function capture(name) {
        await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
        await new Promise((resolve) => setTimeout(resolve, 100));
        fs.writeFileSync(path.join(output, name), (await window.webContents.capturePage()).toPNG());
      }
      await capture("overview.png");
      await evaluate(`document.querySelector('.filterbar [aria-label="1 day"]').click()`);
      await waitFor(`document.querySelector('.usage-chart svg')?.getAttribute('aria-label') === 'Hourly cost chart'`);
      for (const [index, metric] of ["cost", "tokens", "requests"].entries()) {
        await evaluate(`document.querySelectorAll('.metric-tabs button')[${index}].click()`);
        await waitFor(
          `document.querySelector('.usage-chart svg')?.getAttribute('aria-label') === 'Hourly ${metric} chart'`
        );
        assert.equal(await evaluate(`document.querySelectorAll('.usage-chart rect').length`), 24);
        assert.ok(
          await evaluate(
            `document.querySelector('.usage-chart svg').textContent.includes('00:00') && document.querySelector('.usage-chart svg').textContent.includes('23:00')`
          )
        );
      }
      await evaluate(`document.querySelectorAll('.metric-tabs button')[0].click()`);
      await capture("today.png");
      await evaluate(`document.querySelector('.model-row').click()`);
      await waitFor(
        `document.querySelector('dialog .usage-chart svg')?.getAttribute('aria-label') === 'Hourly tokens chart'`
      );
      assert.equal(await evaluate(`document.querySelectorAll('dialog .usage-chart rect').length`), 24);
      await evaluate(
        `document.querySelector('[aria-label="Close dialog"]').click(); document.querySelector('.filterbar [aria-label="All time"]').click()`
      );
      await waitFor(`document.querySelector('.usage-chart svg')?.getAttribute('aria-label') === 'Daily cost chart'`);
      assert.equal(await evaluate(`document.querySelectorAll('select').length`), 0);
      await openChoice("Models");
      await capture("models-menu.png");
      await window.webContents.insertText("no-such-model");
      await waitFor(`document.querySelector('.choice-empty')?.textContent === 'No matches'`);
      key("Escape");
      await waitFor(`!document.querySelector('.choice-popup')`);
      assert.equal(await evaluate(`document.activeElement.getAttribute('aria-label')`), "Models");
      await openChoice("Models");
      key("Tab");
      await waitFor(`!document.querySelector('.choice-popup')`);
      assert.equal(
        await evaluate(`document.activeElement.getAttribute('aria-label')`),
        "Projects",
        "Tab continues to the next filter"
      );
      let virtualRows;
      if (large) {
        await openChoice("Projects");
        await waitFor(`document.querySelector('.choice-option[aria-setsize]')`);
        virtualRows = await evaluate(`document.querySelectorAll('.choice-option').length`);
        assert.ok(virtualRows < 40, `10,000 projects must not create 10,000 DOM rows (${virtualRows})`);
        await capture("projects-large.png");
        for (let step = 0; step < 25; step++) {
          key("ArrowDown");
          await evaluate(`new Promise(resolve => requestAnimationFrame(resolve))`);
        }
        await waitFor(
          `(() => { const active = document.activeElement.getAttribute('aria-activedescendant'); return Number(document.getElementById(active)?.getAttribute('aria-posinset')) >= 25; })()`
        );
        await evaluate(
          `{ const scroller = document.querySelector('.choice-virtual-scroll'); scroller.scrollTop = scroller.scrollHeight; }`
        );
        await waitFor(
          `(() => { const row = document.querySelector('.choice-option:last-child'); return row?.getAttribute('aria-posinset') === row?.getAttribute('aria-setsize'); })()`
        );
        key("Escape");
        await waitFor(`!document.querySelector('.choice-popup')`);
        await openChoice("Projects", "stress-project-09999");
        await waitFor(`document.querySelectorAll('.choice-option').length === 1`);
        key("ArrowDown");
        key("Enter");
        await waitFor(
          `!document.querySelector('.choice-popup') && document.querySelector('[aria-label="Projects"]').textContent.includes('stress-project-09999')`
        );
        await evaluate(`document.querySelector('[aria-label="Clear usage filters"]').click()`);
      }
      for (const name of [
        "activity",
        "calls",
        "models",
        "projects",
        "sessions",
        "providers",
        "badges",
        "limits",
        "overview"
      ]) {
        await evaluate(
          `document.querySelectorAll('.sidebar nav button')[${["overview", "activity", "calls", "models", "projects", "sessions", "providers", "badges", "limits"].indexOf(name)}].click()`
        );
        await waitFor(`document.querySelector('h1')?.textContent.toLowerCase() === '${name}'`);
        if (name === "calls") {
          await waitFor(`document.querySelector('.stats-grid') && document.body.innerText.includes('Total calls')`);
          const alignment = await evaluate(
            `(() => { const trigger = document.querySelector('.calls-toolbar .choice-trigger').getBoundingClientRect(); const meta = document.querySelector('.toolbar-meta').getBoundingClientRect(); return Math.abs((trigger.top + trigger.height / 2) - (meta.top + meta.height / 2)); })()`
          );
          assert.ok(alignment <= 0.5, `Call toolbar controls must share a vertical centre (${alignment}px)`);
          await openChoice("Tool-call source");
          const gap = await evaluate(
            `document.querySelector('.choice-option').getBoundingClientRect().top - document.querySelector('.choice-search').getBoundingClientRect().bottom`
          );
          assert.ok(gap <= 8, `Menu items must follow the search field (${gap}px)`);
          await capture("calls-menu.png");
          await window.webContents.insertText("claude");
          await waitFor(`document.querySelectorAll('.choice-option').length === 1`);
          key("ArrowDown");
          key("Enter");
          await waitFor(
            `!document.querySelector('.choice-popup') && document.querySelector('.stats-grid .stat strong').textContent === '${claudeCalls}'`
          );
          await pickChoice("Tool-call source", "");
          assert.equal(await evaluate(`document.querySelector('.two-columns .panel .share-bars').children.length`), 5);
          await evaluate(`document.querySelector('.two-columns .panel .list-more').click()`);
          assert.ok(await evaluate(`document.querySelector('.two-columns .panel .share-bars').children.length > 5`));
          await evaluate(`document.querySelector('.two-columns .panel .list-collapse').click()`);
          const usageBefore = await evaluate(`window.cinder.snapshotUsage().then(value => value.scannedAt)`);
          const callsBefore = await evaluate(`window.cinder.snapshotCalls().then(value => value.scannedAt)`);
          await evaluate(`document.querySelector('.refresh-button').click()`);
          await waitFor(
            `window.cinder.snapshotCalls().then(value => value.scannedAt !== ${JSON.stringify(callsBefore)})`
          );
          assert.equal(
            await evaluate(`window.cinder.snapshotUsage().then(value => value.scannedAt)`),
            usageBefore,
            "Refreshing Calls must not rescan usage"
          );
        }
        assert.equal(await evaluate(`!!document.querySelector('[role="alert"]')`), false, name);
        assert.equal(
          await evaluate(
            `document.querySelector('.workspace').scrollWidth <= document.querySelector('.workspace').clientWidth`
          ),
          true,
          `${name} horizontal overflow`
        );
        if (name === "sessions") {
          assert.ok(await evaluate(`document.querySelectorAll('.session-item').length <= 5`));
          await evaluate(`document.querySelector('[aria-label="Search sessions"]').focus()`);
          await window.webContents.insertText("gpt-5");
          await waitFor(
            `Array.from(document.querySelectorAll('.session-item code')).some(element => element.textContent === 'session-1')`
          );
          await evaluate(`document.querySelector('[aria-label="Clear session search"]').click()`);
          await waitFor(`!document.querySelector('[aria-label="Clear session search"]')`);
          assert.equal(
            await evaluate(
              `document.querySelector('.context-chart polyline').getAttribute('points').split(' ').length > 1 || !!document.querySelector('.context-chart circle')`
            ),
            true,
            "A session with one usage bucket must still have a visible point"
          );
        }
        if (name === "limits") {
          await waitFor(`document.querySelector('.quota-card') && !document.querySelector('.refresh-button').disabled`);
          assert.equal(await evaluate(`document.querySelectorAll('.quota-card').length`), 5);
          await evaluate(
            `document.querySelector('.limits-view > .expandable-list > .list-actions .list-more').click()`
          );
          await waitFor(`document.querySelectorAll('.quota-card').length === 6`);
          await waitFor(
            `Array.from(document.querySelectorAll('.quota-card')).some(card => card.innerText.includes('Pro Plus'))`
          );
          assert.equal(await evaluate(`document.querySelector('.limits-grid').innerText.includes('pro_plus')`), false);
          assert.equal(
            await evaluate(
              `Array.from(document.querySelectorAll('.quota-window')).find(row => row.querySelector('.quota-label > span')?.textContent === 'Paid credits').querySelector('strong').textContent.trim()`
            ),
            "$0.00 left"
          );
          assert.equal(
            await evaluate(
              `Array.from(document.querySelectorAll('.quota-window')).find(row => row.querySelector('.quota-label > span')?.textContent === 'Paid credits').querySelector('.quota-caption').textContent.trim()`
            ),
            "Paid balance only"
          );
          const cardColumns = await evaluate(`(() => {
            const columns = new Map();
            for (const card of document.querySelectorAll('.quota-card')) {
              const bounds = card.getBoundingClientRect(), x = Math.round(bounds.left);
              if (!columns.has(x)) columns.set(x, []);
              columns.get(x).push({ top: bounds.top, bottom: bounds.bottom });
            }
            return [...columns.values()].map(rows => rows.sort((a, b) => a.top - b.top));
          })()`);
          assert.equal(
            cardColumns.length,
            2,
            JSON.stringify(
              await evaluate(
                `({ width: innerWidth, columns: getComputedStyle(document.querySelector('.limits-grid')).columnCount })`
              )
            )
          );
          for (const rows of cardColumns)
            for (let index = 1; index < rows.length; index++) {
              const gap = rows[index].top - rows[index - 1].bottom;
              assert.ok(gap >= 19 && gap <= 21, `Provider cards must stack without empty grid rows (${gap}px)`);
            }
          assert.equal(await evaluate(`!!document.querySelector('.status-dot')`), false);
          assert.equal(
            await evaluate(`document.querySelector('.limits-view').outerHTML.includes('work@example.test')`),
            false
          );
          await evaluate(`document.querySelector('.quota-account-row .sensitive-text').click()`);
          await waitFor(
            `document.querySelector('.quota-account-row .sensitive-text').getAttribute('aria-pressed') === 'true'`
          );
          assert.ok(
            await evaluate(
              `document.querySelector('.quota-account-row .sensitive-text').textContent.includes('@example.test')`
            )
          );
          await evaluate(`document.querySelector('.quota-account-row .sensitive-text').click()`);
          await waitFor(
            `document.querySelector('.quota-account-row .sensitive-text').getAttribute('aria-pressed') === 'false'`
          );
          assert.equal(
            await evaluate(`document.querySelector('.limits-view').outerHTML.includes('@example.test')`),
            false
          );
          await capture("limits.png");
          await evaluate(`document.querySelector('[aria-label="Inspect Codex account 1"]').click()`);
          await waitFor(`document.querySelector('dialog').innerText.includes('banked reset credits')`);
          await capture("limits-account.png");
          assert.equal(resetRequests.length, 0);
          await evaluate(
            `Array.from(document.querySelectorAll('dialog button')).find(button => button.textContent === 'Use a reset credit').click()`
          );
          await waitFor(`document.querySelector('dialog').innerText.includes('Use one reset credit?')`);
          assert.equal(resetRequests.length, 0, "Opening confirmation must not consume a credit");
          await evaluate(
            `Array.from(document.querySelectorAll('dialog button')).find(button => button.textContent === 'Use one credit').click()`
          );
          await waitFor(
            `document.querySelector('dialog .primary')?.textContent === 'Applying reset…' && document.querySelector('[aria-label="Close dialog"]').disabled`
          );
          key("Escape");
          assert.equal(await evaluate(`document.querySelector('dialog')?.open`), true);
          await waitFor(`document.querySelector('[role="alert"]')?.textContent.includes('Synthetic interruption')`);
          await evaluate(
            `Array.from(document.querySelectorAll('dialog button')).find(button => button.textContent === 'Retry same reset').click()`
          );
          await waitFor(`document.querySelector('.account-details') && !document.querySelector('[role="alert"]')`);
          assert.equal(resetRequests.length, 2);
          await evaluate(`document.querySelector('[aria-label="Close dialog"]').click()`);
          const usageBefore = await evaluate(`window.cinder.snapshotUsage().then(value => value.scannedAt)`);
          await evaluate(`document.querySelector('.refresh-button').click()`);
          await waitFor(`!document.querySelector('.refresh-button').disabled`);
          assert.equal(await evaluate(`window.cinder.snapshotUsage().then(value => value.scannedAt)`), usageBefore);
          await evaluate(`document.querySelector('[aria-label="Inspect Claude account 1"]').click()`);
          await waitFor(`document.querySelector('[aria-label="Reset credit type"]')`);
          await pickChoice("Reset credit type", "fable");
          await evaluate(
            `Array.from(document.querySelectorAll('dialog button')).find(button => button.textContent === 'Use a reset credit').click()`
          );
          await waitFor(`document.querySelector('dialog').innerText.includes('Other weekly usage remains')`);
          await capture("claude-reset.png");
          const beforeSignout = quota;
          delayedQuota = true;
          quota = { ...quota, accounts: quota.accounts.filter((item) => item.id !== "c".repeat(24)) };
          key("R", [process.platform === "darwin" ? "meta" : "control"]);
          await waitFor(
            `document.querySelector('dialog .primary')?.textContent === 'Checking account…' && !document.querySelector('[aria-label="Close dialog"]').disabled`
          );
          await waitFor(`!document.querySelector('dialog') && !document.querySelector('.refresh-button').disabled`);
          quota = beforeSignout;
          delayedQuota = false;
          await evaluate(`document.querySelector('.refresh-button').click()`);
          await waitFor(`!document.querySelector('.refresh-button').disabled`);
          assert.equal(resetRequests.length, 2);
          await evaluate(`document.querySelector('[aria-label="Inspect Cursor account 1"]').click()`);
          await waitFor(`document.querySelector('.cursor-account-usage')`);
          await evaluate(`document.querySelector('.cursor-account-usage .button').click()`);
          await waitFor(`document.querySelector('.cursor-account-usage .stats-grid')`);
          assert.equal(
            await evaluate(`document.querySelector('.cursor-account-usage .stat:nth-child(2) strong').textContent`),
            "8"
          );
          assert.equal(await evaluate(`document.querySelectorAll('.cursor-account-usage .share-row').length`), 5);
          await evaluate(`document.querySelector('.cursor-account-usage').scrollIntoView({block:'center'})`);
          await capture("cursor-usage.png");
          await pickChoice("Cursor account period", "7");
          await waitFor(
            `document.querySelector('.cursor-account-usage .stats-grid') && !document.querySelector('.account-usage-controls').disabled`
          );
          await evaluate(`document.querySelector('[aria-label="Close dialog"]').click()`);
          await evaluate(`document.querySelector('[aria-label="Inspect Antigravity account"]').click()`);
          await waitFor(`document.querySelector('.account-details')?.textContent.includes('Authorization expired')`);
          await evaluate(`document.querySelector('[aria-label="Close dialog"]').click()`);
        }
        await capture(`${name}.png`);
      }
      await evaluate(`document.querySelector('.model-row').click()`);
      await waitFor(`document.querySelector('dialog').open`);
      assert.equal(await evaluate(`document.querySelector('dialog').innerText.includes('Cache hit rate')`), true);
      await evaluate(`document.querySelector('.model-pricing-details').open = true`);
      await waitFor(`!document.querySelector('.pricing-editor [type="submit"]').disabled`);
      await evaluate(`document.querySelector('.pricing-editor').scrollIntoView({block:'center'})`);
      await capture("pricing.png");
      const priceInputs = await evaluate(`document.querySelectorAll('.pricing-editor input[type="number"]').length`);
      assert.equal(priceInputs, 5);
      for (let index = 0; index < priceInputs; index++) {
        await evaluate(`document.querySelectorAll('.pricing-editor input[type="number"]')[${index}].focus()`);
        key("A", [process.platform === "darwin" ? "meta" : "control"]);
        await window.webContents.insertText("0");
      }
      await evaluate(`document.querySelector('.pricing-editor [type="submit"]').click()`);
      await waitFor(`document.querySelector('.pricing-editor [role="status"]')?.textContent.includes('recalculated')`);
      assert.equal((await evaluate(`window.cinder.readPricing()`))[0].input, 0);
      assert.equal(
        await evaluate(
          `Number(document.querySelector('dialog .stats-grid .stat:nth-child(2) strong').textContent.replace(/[^0-9.]/g, ''))`
        ),
        0
      );
      await evaluate(
        `Array.from(document.querySelectorAll('.pricing-editor button')).find(button => button.textContent === 'Restore catalog pricing').click()`
      );
      await waitFor(
        `window.cinder.readPricing().then(rules => rules.length === 0 && !document.querySelector('.pricing-editor [type="submit"]').disabled)`
      );
      await evaluate(
        `document.querySelector('[aria-label="Close dialog"]').click(); document.querySelector('.sidebar-settings').click()`
      );
      await waitFor(`document.querySelector('dialog').innerText.includes('Appearance')`);
      await openChoice("Pricing tool");
      key("Escape");
      await waitFor(`!document.querySelector('.choice-popup')`);
      assert.equal(
        await evaluate(`document.querySelector('dialog').open`),
        true,
        "Escape closes a settings menu before its parent dialog"
      );
      await evaluate(`document.querySelector('.appearance-settings .list-more').click()`);
      assert.equal(await evaluate(`document.querySelectorAll('.theme-card').length`), 15);
      await evaluate(`document.querySelector('[aria-label="Use Cinder theme"]').click()`);
      await waitFor(`localStorage.getItem('cinder-theme-dark') === 'cinder'`);
      await capture("themes-dark.png");
      await evaluate(`document.querySelector('[aria-label="Light mode"]').click()`);
      await waitFor(`document.documentElement.classList.contains('light')`);
      await evaluate(`document.querySelector('[aria-label="Search themes"]').focus()`);
      await window.webContents.insertText("nord");
      await waitFor(`document.querySelectorAll('.theme-card').length === 1`);
      await evaluate(`document.querySelector('[aria-label="Use Nord theme"]').click()`);
      await waitFor(`localStorage.getItem('cinder-theme-light') === 'nord'`);
      await evaluate(`document.querySelector('[aria-label="Dark mode"]').click()`);
      await waitFor(`document.documentElement.style.getPropertyValue('--background') === '#191614'`);
      await evaluate(`document.querySelector('[aria-label="System mode"]').click()`);
      nativeTheme.themeSource = "light";
      await waitFor(
        `document.documentElement.classList.contains('light') && document.documentElement.style.getPropertyValue('--background') === '#eceff4'`
      );
      nativeTheme.themeSource = "dark";
      await waitFor(`document.documentElement.classList.contains('dark')`);
      await evaluate(`document.querySelector('[role="switch"]').click()`);
      await waitFor(`document.querySelector('[role="switch"]').getAttribute('aria-checked') === 'true'`);
      await evaluate(
        `document.querySelector('[role="switch"]').click(); document.querySelector('[aria-label="Light mode"]').click()`
      );
      await waitFor(`document.documentElement.classList.contains('light')`);
      await capture("settings-light.png");
      await evaluate(`document.querySelector('[aria-label="Close dialog"]').click()`);
      await evaluate(`document.querySelector('.titlebar-actions > button').click()`);
      await waitFor(`document.querySelector('dialog').innerText.includes('Commands')`);
      await window.webContents.insertText("  theme  ");
      await waitFor(`document.querySelectorAll('.command-list button').length === 1`);
      key("ArrowUp");
      await waitFor(`document.activeElement.matches('.command-list button')`);
      assert.equal(await evaluate(`document.activeElement.textContent.trim()`), "Change theme");
      await evaluate(`document.activeElement.click()`);
      await waitFor(`document.querySelector('.modal-heading h2')?.textContent === 'Appearance'`);
      assert.equal(await evaluate(`document.activeElement.tagName`), "BUTTON");
      await evaluate(`document.querySelector('[aria-label="Close dialog"]').click()`);
      key("A", [process.platform === "darwin" ? "meta" : "control", "alt"]);
      await waitFor(`document.querySelector('.modal-heading h2')?.textContent === 'Appearance'`);
      key("K", [process.platform === "darwin" ? "meta" : "control"]);
      assert.equal(await evaluate(`document.querySelectorAll('dialog[open]').length`), 1);
      assert.equal(await evaluate(`document.querySelector('.modal-heading h2').textContent`), "Appearance");
      key("Escape");
      await waitFor(`!document.querySelector('dialog')`);
      window.setSize(940, 600);
      window.webContents.setZoomFactor(1);
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.equal(
        await evaluate(
          `document.querySelector('.workspace').scrollWidth <= document.querySelector('.workspace').clientWidth`
        ),
        true,
        "minimum window width"
      );
      await capture("minimum-window.png");
      await openChoice("Projects");
      const bounds = await evaluate(
        `(() => { const box = document.querySelector('.choice-popup').getBoundingClientRect(); return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: innerWidth, height: innerHeight }; })()`
      );
      assert.ok(
        bounds.left >= 0 && bounds.right <= bounds.width && bounds.top >= 0 && bounds.bottom <= bounds.height,
        "A menu must remain inside the minimum-size window"
      );
      await capture("minimum-menu.png");
      key("Escape");
      await waitFor(`!document.querySelector('.choice-popup')`);
      for (let index = 0; index < 9; index++) {
        await evaluate(`document.querySelectorAll('.sidebar nav button')[${index}].click()`);
        await new Promise((resolve) => setTimeout(resolve, 60));
        assert.equal(
          await evaluate(
            `document.querySelector('.workspace').scrollWidth <= document.querySelector('.workspace').clientWidth`
          ),
          true,
          `minimum-size view ${index + 1}`
        );
        if (index === 8)
          assert.equal(await evaluate(`getComputedStyle(document.querySelector('.limits-grid')).columnCount`), "1");
      }
      await evaluate(`document.querySelector('.sidebar nav button').click()`);
      assert.deepEqual(errors, []);
      await evaluate(`location.reload()`);
      await waitFor(`document.querySelector('.scan-welcome')?.innerText.includes('Saved scan')`);
      await evaluate(`document.querySelector('.scan-welcome .primary').click()`);
      await waitFor(`document.querySelector('.stats-grid') && !document.querySelector('.scan-welcome')`);
      ipcMain.removeHandler("snapshot:info");
      ipcMain.handle("snapshot:info", () => {
        throw new Error("Snapshot read failed");
      });
      await evaluate(`location.reload()`);
      await waitFor(`document.querySelector('[role="alert"]')?.textContent.includes('Snapshot read failed')`);
      ipcMain.removeHandler("snapshot:info");
      ipcMain.handle("snapshot:info", () => null);
      await evaluate(`document.querySelector('[role="alert"] button').click()`);
      await waitFor(`document.querySelector('.stats-grid') && !document.querySelector('[role="alert"]')`);
      assert.deepEqual(errors, []);
      fs.writeFileSync(
        path.join(output, "smoke.json"),
        JSON.stringify(
          {
            passed: true,
            sources: info.sources,
            views: 9,
            platform: process.platform,
            electron: process.versions.electron,
            packaged: Boolean(process.env.CINDER_SMOKE_APP),
            large,
            virtualRows,
            timestamp: new Date().toISOString()
          },
          null,
          2
        )
      );
      console.log(
        "Electron smoke passed: 19 sources, 9 views, quota reset retry, model detail, settings, themes, commands, minimum window."
      );
      app.exit(0);
    } catch (error) {
      console.error(error);
      try {
        console.error(
          await evaluate(
            `({ active: document.activeElement?.tagName, label: document.activeElement?.getAttribute('aria-label'), expanded: document.activeElement?.getAttribute('aria-expanded'), activeId: document.activeElement?.getAttribute('aria-activedescendant'), highlighted: document.querySelector('.choice-option[data-highlighted]')?.getAttribute('aria-posinset'), scrollTop: document.querySelector('.choice-virtual-scroll')?.scrollTop, rendered: Array.from(document.querySelectorAll('.choice-option')).map(row => row.getAttribute('aria-posinset')), menu: !!document.querySelector('.choice-popup') })`
          )
        );
      } catch {}
      app.exit(1);
    }
  });
});
require(process.env.CINDER_SMOKE_APP || "../main.js");
