const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  path = require('node:path'),
  fs = require('node:fs');
const bundle = path.resolve(__dirname, '../node_modules/.cache/navigation-move-test.cjs');
fs.mkdirSync(path.dirname(bundle), { recursive: true });
require('esbuild').buildSync({
  entryPoints: [path.resolve(__dirname, '../client/navigation-move.js')],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'cjs',
});
const { moveNavigationItem } = require(bundle);
test('dragging reorders siblings correctly in both directions without mutating the source', () => {
  const original = { guide: ['a', 'b', 'c'] };
  assert.deepEqual(
    moveNavigationItem(
      original,
      { sidebar: 'guide', parts: [2] },
      { sidebar: 'guide', parts: [0], where: 'before' },
    ).guide,
    ['c', 'a', 'b'],
  );
  assert.deepEqual(
    moveNavigationItem(
      original,
      { sidebar: 'guide', parts: [0] },
      { sidebar: 'guide', parts: [2], where: 'after' },
    ).guide,
    ['b', 'c', 'a'],
  );
  assert.deepEqual(
    moveNavigationItem(
      original,
      { sidebar: 'guide', parts: [2] },
      { sidebar: 'guide', parts: [0], where: 'after' },
    ).guide,
    ['a', 'c', 'b'],
  );
  assert.deepEqual(original.guide, ['a', 'b', 'c']);
});
test('dragging moves pages across sections and adjusts parent indexes safely', () => {
  const original = { guide: ['a', { type: 'category', label: 'Section', items: ['b'] }] };
  assert.deepEqual(
    moveNavigationItem(
      original,
      { sidebar: 'guide', parts: [0] },
      { sidebar: 'guide', parts: [1], where: 'inside' },
    ).guide,
    [{ type: 'category', label: 'Section', items: ['b', 'a'] }],
  );
  const nested = {
    guide: [
      { type: 'category', label: 'One', items: ['a'] },
      { type: 'category', label: 'Two', items: ['b'] },
    ],
  };
  const moved = moveNavigationItem(
    nested,
    { sidebar: 'guide', parts: [0] },
    { sidebar: 'guide', parts: [1, 0], where: 'before' },
  );
  assert.equal(moved.guide.length, 1);
  assert.equal(moved.guide[0].items[0].label, 'One');
  assert.equal(moved.guide[0].items[1], 'b');
});
test('dragging can enter an empty sidebar and rejects self-containment or stale targets', () => {
  const source = {
    one: [
      {
        type: 'category',
        label: 'Parent',
        items: [{ type: 'category', label: 'Child', items: [] }],
      },
    ],
    two: [],
  };
  const moved = moveNavigationItem(
    source,
    { sidebar: 'one', parts: [0] },
    { sidebar: 'two', parts: [], where: 'inside' },
  );
  assert.equal(moved.one.length, 0);
  assert.equal(moved.two[0].label, 'Parent');
  assert.throws(
    () =>
      moveNavigationItem(
        source,
        { sidebar: 'one', parts: [0] },
        { sidebar: 'one', parts: [0, 0], where: 'inside' },
      ),
    /itself/,
  );
  assert.throws(
    () =>
      moveNavigationItem(
        source,
        { sidebar: 'one', parts: [0] },
        { sidebar: 'one', parts: [0], where: 'inside' },
      ),
    /itself/,
  );
  assert.throws(
    () =>
      moveNavigationItem(
        source,
        { sidebar: 'one', parts: [0] },
        { sidebar: 'one', parts: [9], where: 'before' },
      ),
    /drop position/,
  );
  assert.deepEqual(
    moveNavigationItem(
      source,
      { sidebar: 'one', parts: [0] },
      { sidebar: 'one', parts: [0], where: 'before' },
    ),
    source,
  );
});
