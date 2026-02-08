import { parse } from '/home/ubuntu/meta-product-insights/node_modules/.pnpm/regexparam@3.0.0/node_modules/regexparam/dist/index.mjs';

const path = '/schedules/1/history';

const pattern1 = parse('/schedules/:id/history');
const pattern2 = parse('/schedules');

console.log('Testing path:', path);
console.log('');
console.log('Pattern /schedules/:id/history:');
console.log('  regex:', pattern1.pattern);
console.log('  matches:', pattern1.pattern.test(path));
console.log('  exec:', pattern1.pattern.exec(path));
console.log('');
console.log('Pattern /schedules:');
console.log('  regex:', pattern2.pattern);
console.log('  matches:', pattern2.pattern.test(path));
console.log('  exec:', pattern2.pattern.exec(path));
