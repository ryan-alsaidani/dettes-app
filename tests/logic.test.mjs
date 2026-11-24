import assert from 'node:assert/strict';
import { parseDinars, formatMillimes } from '../app/src/main/assets/www/js/money.js';
import { normalize, matches } from '../app/src/main/assets/www/js/search.js';

assert.equal(parseDinars('1.5'), 1500);
assert.equal(parseDinars('1,500'), 1500);
assert.equal(parseDinars('0.001'), 1);
assert.equal(parseDinars('12'), 12000);
assert.equal(parseDinars('١٫٢٥'), 1250);
assert.equal(parseDinars('abc'), null);
assert.equal(parseDinars('1.2345'), null);
assert.equal(parseDinars(''), null);
assert.equal(formatMillimes(1500), '1.500 د');
assert.equal(formatMillimes(0), '0.000 د');
assert.equal(formatMillimes(5), '0.005 د');
assert.equal(formatMillimes(-2250), '-2.250 د');

assert.equal(normalize('  أَحْمَدُ  '), 'احمد');
assert.equal(normalize('إبراهيم'), 'ابراهيم');
assert.equal(normalize('فاطمة'), 'فاطمه');
assert.equal(normalize('مصطفى'), 'مصطفي');
assert.equal(normalize('محـــمد'), 'محمد');
assert.ok(matches('احم', normalize('أحمد بن علي')));
assert.ok(matches('بن علي', normalize('أحمد بن علي')));
assert.ok(matches('علي احمد', normalize('أحمد بن علي')));
assert.ok(!matches('سالم', normalize('أحمد بن علي')));
assert.ok(matches('', 'x'));
assert.ok(matches('فاطمه', normalize('فاطمة')));
console.log('logic tests OK');
