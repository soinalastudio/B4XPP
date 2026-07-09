(function () {
  'use strict';
  let vscode;
  try { vscode = acquireVsCodeApi(); } catch (err) {
    const status = document.getElementById('saveStatus');
    if (status) status.textContent = 'B4X++ WebView error: acquireVsCodeApi() is not available.';
    return;
  }
  function el(id) { return document.getElementById(id); }
  function normalizeListFromText(value) { return String(value || '').split(/\r?\n|[,;]/).map(s => s.trim()).filter(Boolean); }
  function setStatus(text) { const status = el('saveStatus'); if (status) status.textContent = text; }
  function parseInitialState() {
    const node = el('b4xpp-state-json');
    if (!node) return {};
    try { return JSON.parse(node.textContent || '{}') || {}; }
    catch (err) { setStatus('B4X++ WebView state parse error: ' + (err && err.message ? err.message : err)); return {}; }
  }
  let state = parseInitialState();
  const arrayKeys = ['b4j.internalLibraryDirs','b4j.additionalLibraryDirs','b4a.internalLibraryDirs','b4a.additionalLibraryDirs','b4i.internalLibraryDirs','b4i.additionalLibraryDirs'];
  const boolKeys = ['buildShowWarnings','buildUseBaseFolder','banano.runJarAfterBuild','banano.promptServeAfterRun','bananoServer.openBrowser','validation.strict','enableSemanticDiagnostics'];
  const stringKeys = ['b4j.builderPath','b4a.builderPath','b4i.builderPath','b4jBuildCommand','b4aBuildCommand','b4iBuildCommand','buildTask','banano.javaPath','banano.javaFxLibPath','bananoServer.port'];
  function setTextarea(key, values) {
    const node = document.querySelector('[data-key="' + key + '"]');
    if (node) node.value = (Array.isArray(values) ? values : []).join('\n');
  }
  function getTextarea(key) {
    const node = document.querySelector('[data-key="' + key + '"]');
    return node ? normalizeListFromText(node.value) : [];
  }
  function applyState(next) {
    state = next || {};
    for (const key of stringKeys) {
      const node = document.querySelector('[data-key="' + key + '"]');
      if (node) node.value = state[key] == null ? '' : state[key];
    }
    for (const key of boolKeys) {
      const node = document.querySelector('[data-key="' + key + '"]');
      if (node) node.checked = state[key] === true;
    }
    for (const key of arrayKeys) setTextarea(key, state[key]);
  }
  function collectValues() {
    const values = {};
    for (const key of stringKeys) {
      const node = document.querySelector('[data-key="' + key + '"]');
      values[key] = node ? node.value : '';
    }
    for (const key of boolKeys) {
      const node = document.querySelector('[data-key="' + key + '"]');
      values[key] = node ? node.checked : false;
    }
    for (const key of arrayKeys) values[key] = getTextarea(key);
    return values;
  }
  function postToExtension(payload) { try { vscode.postMessage(payload); } catch (err) { setStatus('WebView postMessage failed: ' + (err && err.message ? err.message : err)); } }
  function save() { setStatus('Saving B4X++ global settings...'); postToExtension({ type: 'save', values: collectValues() }); }
  function reload() { postToExtension({ type: 'reload' }); }
  function openUserSettingsJson() { postToExtension({ type: 'openUserSettingsJson' }); }
  function migrateWorkspaceSettings() { setStatus('Migrating workspace tool settings to global settings...'); postToExtension({ type: 'migrateWorkspaceSettings' }); }
  function browseDir(key) { postToExtension({ type: 'browseDir', key }); }
  function browseFile(key) { postToExtension({ type: 'browseFile', key }); }
  function wireButtons() {
    const saveBtn = el('save'); if (saveBtn) saveBtn.addEventListener('click', save);
    const reloadBtn = el('reload'); if (reloadBtn) reloadBtn.addEventListener('click', reload);
    const openBtn = el('openUserSettingsJson'); if (openBtn) openBtn.addEventListener('click', openUserSettingsJson);
    const migrateBtn = el('migrateWorkspaceSettings'); if (migrateBtn) migrateBtn.addEventListener('click', migrateWorkspaceSettings);
    document.querySelectorAll('[data-browse-dir]').forEach(btn => btn.addEventListener('click', () => browseDir(btn.getAttribute('data-browse-dir'))));
    document.querySelectorAll('[data-browse-file]').forEach(btn => btn.addEventListener('click', () => browseFile(btn.getAttribute('data-browse-file'))));
  }
  window.addEventListener('message', event => {
    const msg = event.data;
    if (!msg) return;
    if (msg.type === 'dirPicked') {
      const node = document.querySelector('[data-key="' + msg.key + '"]');
      if (!node) return;
      if (arrayKeys.includes(msg.key)) {
        const current = getTextarea(msg.key);
        const seen = new Set(current.map(x => String(x).toLowerCase()));
        for (const value of msg.values || []) if (!seen.has(String(value).toLowerCase())) current.push(value);
        setTextarea(msg.key, current);
      } else {
        node.value = (msg.values || [])[0] || '';
      }
      setStatus('Folder selected. Click Save global settings to persist it.');
    } else if (msg.type === 'filePicked') {
      const node = document.querySelector('[data-key="' + msg.key + '"]');
      if (node) node.value = msg.value || '';
      setStatus('File selected. Click Save global settings to persist it.');
    } else if (msg.type === 'saveResult') {
      if (msg.ok) setStatus('Saved global B4X++ settings.'); else setStatus('Save failed: ' + (msg.error || 'unknown error'));
    } else if (msg.type === 'state') {
      applyState(msg.state);
      setStatus('Reloaded B4X++ global settings.');
    }
  });
  function init() {
    try { wireButtons(); applyState(state); setStatus('UI ready: B4X++ global settings v0.5.10'); postToExtension({ type: 'ready' }); }
    catch (err) { setStatus('B4X++ WebView script error: ' + (err && err.message ? err.message : err)); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
