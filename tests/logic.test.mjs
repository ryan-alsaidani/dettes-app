import assert from 'node:assert/strict';
import { parseDinars, formatMillimes, toInputString } from '../app/src/main/assets/www/js/money.js';
import { normalize, matches, suggestBrands } from '../app/src/main/assets/www/js/search.js';

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
assert.equal(toInputString(1500), '1.5');
assert.equal(toInputString(2000), '2');
assert.equal(toInputString(250), '0.25');
assert.equal(toInputString(0), '0');
assert.equal(toInputString(1), '0.001');
for (const m of [0, 1, 250, 1500, 2000, 12345, 999999]) assert.equal(parseDinars(toInputString(m)), m);

const brands = ['بيك', 'فابر كاستل', 'ستابيلو', 'أديداس'];
assert.deepEqual(suggestBrands(brands, ''), brands);
assert.deepEqual(suggestBrands(brands, 'فاب'), ['فابر كاستل']);
assert.deepEqual(suggestBrands(brands, 'بيك'), []);          // مطابق تمامًا: لا اقتراح
assert.deepEqual(suggestBrands(brands, 'اديداس'), []);       // التوحيد: أ→ا
assert.deepEqual(suggestBrands(brands, 'ستا'), ['ستابيلو']);
assert.equal(suggestBrands(brands, '', 2).length, 2);
console.log('logic tests OK');
