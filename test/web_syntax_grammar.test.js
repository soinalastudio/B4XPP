'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'));
}

for (const grammarPath of ['syntaxes/b4xpp.tmLanguage.json', 'syntaxes/b4x.tmLanguage.json']) {
  const grammar = readJson(grammarPath);
  const source = JSON.stringify(grammar);
  assert(source.includes('BANano[A-Za-z0-9_]*'), `${grammarPath} should highlight #BANano... directives`);
  assert(source.includes('meta.embedded.block.css'), `${grammarPath} should contain embedded CSS block scope`);
  assert(source.includes('meta.embedded.block.javascript'), `${grammarPath} should contain embedded JavaScript block scope`);
  assert(source.includes('meta.embedded.inline.html'), `${grammarPath} should contain embedded HTML smart-string scope`);
  assert(source.includes('string.quoted.smart.b4x'), `${grammarPath} should contain generic B4X smart-string scope`);
  assert(source.includes('SMARTJAVASCRIPT'), `${grammarPath} should support #If SmartJavaScript / #If JavaScriptSmart`);
  assert(source.includes('source.css'), `${grammarPath} should include VS Code CSS grammar`);
  assert(source.includes('source.js'), `${grammarPath} should include VS Code JavaScript grammar`);
  assert(source.includes('text.html.basic'), `${grammarPath} should include VS Code HTML grammar`);
}

const pkg = readJson('package.json');
for (const grammar of pkg.contributes.grammars) {
  if (grammar.language === 'b4xpp' || grammar.language === 'b4x') {
    const embedded = grammar.embeddedLanguages || {};
    assert(Object.values(embedded).includes('html'), `${grammar.language} should map embedded HTML to language id`);
    assert(Object.values(embedded).includes('css'), `${grammar.language} should map embedded CSS to language id`);
    assert(Object.values(embedded).includes('javascript'), `${grammar.language} should map embedded JavaScript to language id`);
    assert(Object.keys(embedded).some(k => k.includes('inline.javascript')), `${grammar.language} should map BANRAW smart strings to JavaScript`);
  }
}

console.log('Web syntax grammar tests passed.');
