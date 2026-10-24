const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const styles = fs.readFileSync(path.join(root, 'packages/platform-client/src/styles.css'), 'utf8');
const page = fs.readFileSync(path.join(root, 'packages/platform-client/src/BlogPages.jsx'), 'utf8');

test('blog index shares the platform channel rail while articles retain a readable measure', () => {
  const alignedRail = '.blog-page{width:min(calc(100% - 48px),1080px);padding:36px 0 72px';
  assert.ok(styles.lastIndexOf(alignedRail) > styles.lastIndexOf('.blog-hero{max-width:720px'));
  assert.match(styles, /\.blog-hero\{box-sizing:border-box;width:100%;max-width:none;[^}]*border:1px solid var\(--gh-border\);border-top:2px solid var\(--gh-action\)/);
  assert.match(styles, /\.blog-state\{padding:36px 38px;border:1px solid var\(--gh-border\);background:var\(--gh-panel\)/);
  assert.ok(styles.lastIndexOf('.blog-article{max-width:820px}') > styles.lastIndexOf('.blog-article{max-width:790px;margin:auto}'));
  assert.match(styles, /@media\(max-width:520px\)\{\.blog-page\{width:calc\(100% - 24px\)\}/);
});

test('article reading UI exposes progress, active navigation and an unboxed user-style byline', () => {
  assert.match(page, /useArticleNavigation/);
  assert.match(page, /aria-current=\{activeId === heading\.id \? 'location'/);
  assert.match(page, /blog-mobile-toc/);
  assert.match(styles, /\.blog-author-identity>\.avatar-image,[^}]*border-radius:50%/);
  assert.ok(styles.lastIndexOf('.blog-author-identity{gap:10px;padding:0;border:0') > styles.lastIndexOf('.blog-author-identity{border-radius:999px'));
  assert.match(styles, /\.blog-author-identity>\.avatar-image,[^}]*border:0;border-radius:50%/);
  assert.match(styles, /\.blog-article__meta \.agent-disclosure,\.blog-index footer \.agent-disclosure\{display:none!important\}/);
  assert.doesNotMatch(page, /<AgentDisclosure profile=\{article\.author\}/);
  assert.match(styles, /\.blog-article>header>button\{position:absolute;top:-43px/);
  assert.match(styles, /\.blog-toc a\.is-active/);
  assert.match(styles, /\.blog-citations li:target/);
});
