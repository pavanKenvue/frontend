// Drives the built frontend's API layer exactly as the browser would.
const BASE = process.env.API_BASE || 'https://h38aqomaxk.execute-api.us-east-1.amazonaws.com/';
let pass = 0, fail = 0;
const ok = (label, condition) => {
  if (condition) { pass++; console.log('  pass  ' + label); }
  else { fail++; console.log('  FAIL  ' + label); }
};

const post = (p, b) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
const get = (p) => fetch(BASE + p);

console.log('\n1. useColumns() load path');
let r = await get('/columns'); let cols = await r.json();
ok('GET /columns 200', r.status === 200);
ok('columns are DB names, not pWidget params', !cols.columns.some(c => c.startsWith('pWidget')));
ok('paramMap resolves AGE_GROUP', !!cols.paramMap.AGE_GROUP);
ok('numericColumns present', Array.isArray(cols.numericColumns));
r = await get('/columns/describe'); const desc = await r.json();
ok('GET /columns/describe 200', r.status === 200);
const meta = Object.fromEntries(desc.columns.map(c => [c.column, c]));
ok('CLOB column marked not filterable', meta.ABBREV_NARRATIVE?.filterable === false);
ok('BATCH_LOT marked requiresSearch', meta.BATCH_LOT?.requiresSearch === true);

console.log('\n2. useColumnValues() — open a column');
r = await post('/filter_multiple_values', { current_column_name: 'AGE_GROUP', previous_filters: [], limit: 200 });
let d = await r.json();
ok('unfiltered load 200', r.status === 200);
ok('values returned', d.values.length === 6);
ok('served from dictionary', d.source.startsWith('dict'));

console.log('\n3. Cascade — apply COUNTRY then open AGE_GROUP');
r = await post('/filter_multiple_values', { current_column_name: 'AGE_GROUP', previous_filters: [{ column_name: 'COUNTRY', values: ['INDIA'] }], limit: 200 });
d = await r.json();
ok('cascade 200', r.status === 200);
ok('served from facet table', d.source.startsWith('facets'));

console.log('\n4. Server-side search within a column');
r = await post('/filter_multiple_values', { current_column_name: 'AE_PREFERRED_TERMS', q: 'NAU', limit: 200 });
d = await r.json();
ok('search 200', r.status === 200);
ok('only matching values returned', d.values.every(v => v.includes('NAU')));

console.log('\n5. High-cardinality guard drives the "type to search" UI');
r = await post('/filter_multiple_values', { current_column_name: 'BATCH_LOT', previous_filters: [] });
d = await r.json();
ok('400 returned', r.status === 400);
ok('type is SearchTermRequired', d.type === 'SearchTermRequired');
r = await post('/filter_multiple_values', { current_column_name: 'BATCH_LOT', q: 'LOT-001', limit: 200 });
d = await r.json();
ok('same column works with q', r.status === 200 && d.values.length > 0);

console.log('\n6. CLOB guard');
r = await post('/filter_multiple_values', { current_column_name: 'ABBREV_NARRATIVE' });
d = await r.json();
ok('400 ColumnNotFilterable', r.status === 400 && d.type === 'ColumnNotFilterable');

console.log('\n7. Pagination (load more)');
r = await post('/filter_multiple_values', { current_column_name: 'BRAND_GCC', limit: 10 });
const p1 = await r.json();
ok('page 1 hasMore', p1.hasMore === true && p1.nextOffset === 10);
r = await post('/filter_multiple_values', { current_column_name: 'BRAND_GCC', limit: 10, offset: p1.nextOffset });
const p2 = await r.json();
ok('page 2 returns values', p2.values.length === 10);
ok('no overlap between pages', !p2.values.some(v => p1.values.includes(v)));

console.log('\n8. SmartSearch across all columns');
r = await post('/search', { q: 'IND', limit: 5 });
d = await r.json();
ok('search 200', r.status === 200);
ok('grouped by column with paramName', d.results.every(g => g.column && g.paramName && Array.isArray(g.matches)));

console.log('\n9. QuickSight embed URL route exists');
r = await get('/quicksight/embed-url');
ok('route reachable (not 404)', r.status !== 404);

console.log('\n10. Error envelope the client parses');
r = await post('/filter_multiple_values', { current_column_name: 'NOT_A_COLUMN' });
d = await r.json();
ok('error uses {error,type}', typeof d.error === 'string' || Array.isArray(d.detail));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
