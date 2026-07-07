(function () {
  'use strict';

  let vscode;
  try {
    vscode = acquireVsCodeApi();
  } catch (err) {
    const status = document.getElementById('saveStatus');
    if (status) status.textContent = 'B4X++ WebView error: acquireVsCodeApi() is not available.';
    return;
  }

  function el(id) { return document.getElementById(id); }
  function idForKey(key) { return String(key).replace(/\./g, '_'); }
  function normalizeListFromText(value) {
    return String(value || '').split(/\r?\n|[,;]/).map(s => s.trim()).filter(Boolean);
  }
  function setStatus(text) {
    const status = el('saveStatus');
    if (status) status.textContent = text;
  }
  function parseInitialState() {
    const node = el('b4xpp-state-json');
    if (!node) return {};
    try {
      return JSON.parse(node.textContent || '{}') || {};
    } catch (err) {
      setStatus('B4X++ WebView state parse error: ' + (err && err.message ? err.message : err));
      return {};
    }
  }

  let state = parseInitialState();
  const arrayKeys = ['b4j.internalLibraryDirs', 'b4j.additionalLibraryDirs', 'b4a.internalLibraryDirs', 'b4a.additionalLibraryDirs', 'b4i.internalLibraryDirs', 'b4i.additionalLibraryDirs'];
  const boolKeys = ['validation.strict', 'enableSemanticDiagnostics', 'addGeneratedHeader', 'overwriteGeneratedFiles', 'buildShowWarnings', 'buildUseBaseFolder'];
  const stringKeys = ['sourceDir', 'outputDir', 'projectDir', 'b4xlibDir', 'b4xpplibDir', 'packageName', 'platform', 'b4j.builderPath', 'b4a.builderPath', 'b4i.builderPath', 'b4jBuildCommand', 'b4aBuildCommand', 'b4iBuildCommand', 'buildConfiguration', 'buildTask'];
  const dirStringKeys = ['mainBxPath', 'projectPlatform', 'projectName', 'packageName', 'projectDir', 'mainModule', 'b4xLib', 'b4xLibVersion', 'b4xLibAuthor', 'b4xLibDir', 'b4xppLib', 'b4xppLibVersion', 'b4xppLibAuthor', 'b4xppLibDir'];
  const dirArrayKeys = ['projectDependsOn', 'projectB4JDependsOn', 'projectB4ADependsOn', 'projectB4iDependsOn', 'b4xLibDependsOn', 'b4xLibB4JDependsOn', 'b4xLibB4ADependsOn', 'b4xLibB4iDependsOn', 'b4xppLibSupportedPlatforms', 'b4xppLibDependsOn', 'b4xppLibB4JDependsOn', 'b4xppLibB4ADependsOn', 'b4xppLibB4iDependsOn'];

  function setTextarea(key, values) {
    const node = el(idForKey(key));
    if (node) node.value = (Array.isArray(values) ? values : []).join('\n');
  }
  function getTextarea(key) {
    const node = el(idForKey(key));
    return node ? normalizeListFromText(node.value) : [];
  }
  function setDirTextarea(key, values) {
    const node = el('dir_' + key);
    if (node) node.value = (Array.isArray(values) ? values : []).join('\n');
  }
  function getDirTextarea(key) {
    const node = el('dir_' + key);
    return node ? normalizeListFromText(node.value) : [];
  }
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escapeAttr(value) {
    return escapeHtml(value).replace(/"/g, '&quot;');
  }

  function applyState(next) {
    state = next || {};
    const workspacePath = el('workspacePath');
    if (workspacePath) workspacePath.textContent = state.workspacePath || '';
    const settingsPathNode = el('settingsJsonPath');
    if (settingsPathNode) settingsPathNode.textContent = state.settingsJsonPath || '';
    for (const key of stringKeys) {
      const node = document.querySelector('[data-key="' + key + '"]');
      if (node) node.value = state[key] == null ? '' : state[key];
    }
    for (const key of boolKeys) {
      const node = document.querySelector('[data-key="' + key + '"]');
      if (node) node.checked = state[key] === true;
    }
    for (const key of arrayKeys) setTextarea(key, state[key]);
    applyDirectiveState(state.directives || {});
    renderAvailableLibraries(state.availableLibraries || {});
  }

  function applyDirectiveState(d) {
    for (const key of dirStringKeys) {
      const node = document.querySelector('[data-dir-key="' + key + '"]');
      if (node) node.value = d[key] == null ? '' : d[key];
    }
    for (const key of dirArrayKeys) setDirTextarea(key, d[key]);
    const platforms = new Set((d.b4xLibSupportedPlatforms || d.supportedPlatforms || []).map(v => String(v).toLowerCase()));
    document.querySelectorAll('[data-platform-choice]').forEach(cb => {
      cb.checked = platforms.has(String(cb.getAttribute('data-platform-choice') || '').toLowerCase());
    });
  }

  function collectDirectiveValues() {
    const d = {};
    for (const key of dirStringKeys) {
      const node = document.querySelector('[data-dir-key="' + key + '"]');
      d[key] = node ? node.value : '';
    }
    d.b4xLibSupportedPlatforms = Array.from(document.querySelectorAll('[data-platform-choice]:checked')).map(cb => cb.getAttribute('data-platform-choice'));
    for (const key of dirArrayKeys) d[key] = getDirTextarea(key);
    return d;
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
    values.directives = collectDirectiveValues();
    return values;
  }

  function currentPlatformDependsKey(kind) {
    const d = collectDirectiveValues();
    const project = String(d.projectPlatform || '').toLowerCase();
    const sourcePackage = String(kind || '').toLowerCase() === 'b4xpplib';
    const supportedSource = sourcePackage ? (d.b4xppLibSupportedPlatforms || []) : (d.b4xLibSupportedPlatforms || d.supportedPlatforms || []);
    const supported = supportedSource.map(v => String(v).toLowerCase());
    const prefix = sourcePackage ? 'b4xppLib' : 'project';
    if (supported.length === 1) {
      if (supported[0] === 'b4j') return prefix + 'B4JDependsOn';
      if (supported[0] === 'b4a') return prefix + 'B4ADependsOn';
      if (supported[0] === 'b4i') return prefix + 'B4iDependsOn';
    }
    if (project.includes('b4a')) return prefix + 'B4ADependsOn';
    if (project.includes('b4i')) return prefix + 'B4iDependsOn';
    return prefix + 'B4JDependsOn';
  }

  function selectedDependsSet() {
    const d = collectDirectiveValues();
    const all = [
      ...(d.projectDependsOn || []), ...(d.projectB4JDependsOn || []), ...(d.projectB4ADependsOn || []), ...(d.projectB4iDependsOn || []),
      ...(d.b4xLibDependsOn || []), ...(d.b4xLibB4JDependsOn || []), ...(d.b4xLibB4ADependsOn || []), ...(d.b4xLibB4iDependsOn || []), ...(d.b4xppLibDependsOn || []), ...(d.b4xppLibB4JDependsOn || []), ...(d.b4xppLibB4ADependsOn || []), ...(d.b4xppLibB4iDependsOn || [])
    ];
    return new Set(all.map(v => String(v).toLowerCase()));
  }

  function renderAvailableLibraries(libraries) {
    const host = el('availableLibraries');
    if (!host) return;
    const items = (libraries && libraries.active) || [];
    const selected = selectedDependsSet();
    if (!items.length) {
      host.innerHTML = '<span class="small">No libraries found. Check the active platform and library folders, then reload libraries.</span>';
      return;
    }
    host.innerHTML = '';
    for (const item of items) {
      const row = document.createElement('label');
      row.className = 'librow';
      const checked = selected.has(String(item.name).toLowerCase());
      row.innerHTML = '<input type="checkbox" data-lib-name="' + escapeAttr(item.name) + '" data-lib-kind="' + escapeAttr(item.kind || '') + '" ' + (checked ? 'checked' : '') + '> <span>' + escapeHtml(item.name) + '</span> <code>' + escapeHtml(item.kind || '') + '</code>';
      host.appendChild(row);
    }
    host.querySelectorAll('[data-lib-name]').forEach(cb => cb.addEventListener('change', () => toggleLibrary(cb.getAttribute('data-lib-name'), cb.checked, cb.getAttribute('data-lib-kind'))));
  }

  function toggleLibrary(name, checked, kind) {
    const key = currentPlatformDependsKey(kind);
    let list = getDirTextarea(key);
    const values = new Set(list.map(v => String(v).toLowerCase()));
    if (checked) {
      if (!values.has(String(name).toLowerCase())) list.push(name);
    } else {
      list = list.filter(v => String(v).toLowerCase() !== String(name).toLowerCase());
    }
    setDirTextarea(key, list);
  }

  function postToExtension(payload) {
    try {
      vscode.postMessage(payload);
    } catch (err) {
      setStatus('WebView postMessage failed: ' + (err && err.message ? err.message : err));
    }
  }

  function save() {
    const payload = collectValues();
    setStatus('Saving project settings...');
    postToExtension({ type: 'save', values: payload, refreshIndex: true });
  }
  function reload() { postToExtension({ type: 'reload' }); }
  function openJson() { postToExtension({ type: 'openSettingsJson' }); }
  function reloadLibraries() { postToExtension({ type: 'loadLibraries', values: collectValues() }); }
  function importIdeHeader() { postToExtension({ type: 'importIdeProjectHeader', values: collectValues() }); }
  function browseDir(key) { postToExtension({ type: 'browseDir', key: key }); }

  function wireButtons() {
    const saveBtn = el('save');
    if (saveBtn) saveBtn.addEventListener('click', save);
    const reloadBtn = el('reload');
    if (reloadBtn) reloadBtn.addEventListener('click', reload);
    const reloadLibrariesBtn = el('reloadLibraries');
    if (reloadLibrariesBtn) reloadLibrariesBtn.addEventListener('click', reloadLibraries);
    const openJsonBtn = el('openJson');
    if (openJsonBtn) openJsonBtn.addEventListener('click', openJson);
    const importIdeHeaderBtn = el('importIdeHeader');
    if (importIdeHeaderBtn) importIdeHeaderBtn.addEventListener('click', importIdeHeader);
    document.querySelectorAll('[data-browse]').forEach(btn => {
      btn.addEventListener('click', () => browseDir(btn.getAttribute('data-browse')));
    });
  }

  window.addEventListener('message', event => {
    const msg = event.data;
    if (!msg) return;
    if (msg.type === 'dirPicked') {
      const current = getTextarea(msg.key);
      const seen = new Set(current.map(x => String(x).toLowerCase()));
      for (const value of msg.values || []) if (!seen.has(String(value).toLowerCase())) current.push(value);
      setTextarea(msg.key, current);
      setStatus('Folder added. Click Save and refresh index to persist it.');
    } else if (msg.type === 'saveResult') {
      if (msg.ok) setStatus('Saved: ' + ((msg.settings && msg.settings.settingsFile) || '.vscode/settings.json'));
      else setStatus('Save failed: ' + (msg.error || 'unknown error'));
    } else if (msg.type === 'state') {
      applyState(msg.state);
      setStatus('Reloaded current project settings.');
    } else if (msg.type === 'libraries') {
      state.availableLibraries = msg.libraries || {};
      renderAvailableLibraries(state.availableLibraries);
      setStatus('Libraries reloaded.');
    }
  });

  function init() {
    try {
      wireButtons();
      applyState(state);
      setStatus('UI ready: generics-0.4.2');
      postToExtension({ type: 'ready' });
    } catch (err) {
      setStatus('B4X++ WebView script error: ' + (err && err.message ? err.message : err));
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
