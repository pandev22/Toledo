const assert = require('assert');
const {
  normalizeIp,
  expandIpv6,
  getIpv6Subnet64,
  areIpsEquivalent,
  getClientIp,
  isUserAllowlisted
} = require('../handlers/antiVpnAllowlist');
const createIpCheck = require('../handlers/ipCheck');

console.log('--- 1. Testing normalizeIp ---');
assert.strictEqual(normalizeIp('192.168.1.1'), '192.168.1.1');
assert.strictEqual(normalizeIp('192.168.1.1:8080'), '192.168.1.1');
assert.strictEqual(normalizeIp('::ffff:192.168.1.1'), '192.168.1.1');
assert.strictEqual(normalizeIp('::ffff:192.168.1.1:8080'), '192.168.1.1');
assert.strictEqual(normalizeIp('2001:DB8::1'), '2001:db8::1');
assert.strictEqual(normalizeIp('[2001:db8::1]'), '2001:db8::1');
assert.strictEqual(normalizeIp('[2001:db8::1]:443'), '2001:db8::1');
assert.strictEqual(normalizeIp('::1'), '::1');
assert.strictEqual(normalizeIp('invalid_ip'), null);
assert.strictEqual(normalizeIp(''), null);
assert.strictEqual(normalizeIp(null), null);
console.log('✔ normalizeIp passed');

console.log('--- 2. Testing getClientIp ---');
assert.strictEqual(getClientIp({ headers: { 'cf-connecting-ip': '2001:db8::1' } }), '2001:db8::1');
assert.strictEqual(getClientIp({ headers: { 'x-real-ip': '10.0.0.1' } }), '10.0.0.1');
assert.strictEqual(getClientIp({ headers: { 'x-forwarded-for': '172.16.0.1, 10.0.0.1' } }), '172.16.0.1');
assert.strictEqual(getClientIp({ socket: { remoteAddress: '::ffff:192.168.0.5' } }), '192.168.0.5');
console.log('✔ getClientIp passed');

console.log('--- 3. Testing areIpsEquivalent ---');
assert.strictEqual(areIpsEquivalent('192.168.1.1', '192.168.1.1'), true);
assert.strictEqual(areIpsEquivalent('192.168.1.1', '192.168.1.2'), false);
assert.strictEqual(areIpsEquivalent('2001:db8:1234:5678:1::1', '2001:db8:1234:5678:2::2'), true);
assert.strictEqual(areIpsEquivalent('2001:db8:1234:5678::1', '2001:db8:1234:9999::1'), false);
assert.strictEqual(areIpsEquivalent('::1', '::1'), true);
assert.strictEqual(areIpsEquivalent('::1', '2001:db8::1'), false);
console.log('✔ areIpsEquivalent passed');

console.log('--- 4. Testing createIpCheck with Mock DB ---');
(async () => {
  const ipHistoryRecords = [];
  const bannedUsers = {};
  const allowlistRecords = [];

  const mockDb = {
    antiVpnAllowlist: {
      findFirst: async ({ where }) => {
        return allowlistRecords.find(r => r.ipAddress === where.ipAddress && r.userId === where.users?.some?.userId) || null;
      },
      findMany: async ({ where }) => {
        return allowlistRecords.filter(r => r.userId === where.users?.some?.userId);
      }
    },
    ipHistory: {
      findFirst: async ({ where }) => {
        return ipHistoryRecords.find(record => {
          if (where.NOT?.discordId && record.discordId === where.NOT.discordId) {
            return false;
          }
          if (where.ipAddress) {
            return record.ipAddress === where.ipAddress;
          }
          if (where.OR) {
            return where.OR.some(cond => {
              if (cond.ipAddress?.startsWith) {
                return record.ipAddress.startsWith(cond.ipAddress.startsWith);
              }
              if (typeof cond.ipAddress === 'string') {
                return record.ipAddress === cond.ipAddress;
              }
              return false;
            });
          }
          return false;
        }) || null;
      },
      findMany: async ({ where }) => {
        return ipHistoryRecords.filter(record => {
          if (where.NOT?.discordId && record.discordId === where.NOT.discordId) {
            return false;
          }
          if (where.ipAddress?.contains && !record.ipAddress.includes(where.ipAddress.contains)) {
            return false;
          }
          return true;
        });
      },
      upsert: async ({ where, create, update }) => {
        const existingIdx = ipHistoryRecords.findIndex(
          r => r.ipAddress === where.ipAddress_discordId.ipAddress && r.discordId === where.ipAddress_discordId.discordId
        );
        if (existingIdx >= 0) {
          ipHistoryRecords[existingIdx].userId = update.userId;
          return ipHistoryRecords[existingIdx];
        } else {
          ipHistoryRecords.push({ ...create });
          return create;
        }
      }
    },
    user: {
      update: async ({ where, data }) => {
        bannedUsers[where.id] = data;
        return { id: where.id, ...data };
      }
    }
  };

  const ipCheck = createIpCheck(mockDb);

  // Test 4.1: IPv4 legitimate login
  const r1 = await ipCheck.checkAndRecordIp('1.2.3.4', 'discord-user-1', 'user-1');
  assert.strictEqual(r1.allowed, true, 'User 1 IPv4 first login should be allowed');

  // Test 4.2: IPv4 alt account login from same IP -> Auto Ban!
  const r2 = await ipCheck.checkAndRecordIp('1.2.3.4', 'discord-user-2', 'user-2');
  assert.strictEqual(r2.allowed, false, 'User 2 IPv4 alt login must be banned');
  assert.strictEqual(bannedUsers['user-2']?.isBanned, true, 'User 2 must be marked as banned');
  console.log('✔ IPv4 anti-alt detection verified');

  // Test 4.3: IPv6 legitimate user login
  const ipv6UserA = '2a01:cb08:834:100:1111:2222:3333:4444';
  const r3 = await ipCheck.checkAndRecordIp(ipv6UserA, 'discord-user-3', 'user-3');
  assert.strictEqual(r3.allowed, true, 'User 3 IPv6 first login should be allowed');

  // Test 4.4: IPv6 legitimate user rotates privacy address within same /64 -> Allowed!
  const ipv6UserARotated = '2a01:cb08:834:100:5555:6666:7777:8888';
  const r4 = await ipCheck.checkAndRecordIp(ipv6UserARotated, 'discord-user-3', 'user-3');
  assert.strictEqual(r4.allowed, true, 'User 3 IPv6 rotated address must be allowed (same Discord ID)');

  // Test 4.5: IPv6 ALT ACCOUNT login from same /64 subnet -> Auto Ban!
  const ipv6AltAccount = '2a01:cb08:834:100:9999:aaaa:bbbb:cccc';
  const r5 = await ipCheck.checkAndRecordIp(ipv6AltAccount, 'discord-user-4', 'user-4');
  assert.strictEqual(r5.allowed, false, 'User 4 IPv6 alt login from same /64 must be banned');
  assert.strictEqual(bannedUsers['user-4']?.isBanned, true, 'User 4 must be marked as banned');
  console.log('✔ IPv6 /64 subnet anti-alt detection verified');

  // Test 4.6: IPv6 DIFFERENT household /64 login -> Allowed!
  const ipv6DifferentUser = '2a01:cb08:999:200:1111:2222:3333:4444';
  const r6 = await ipCheck.checkAndRecordIp(ipv6DifferentUser, 'discord-user-5', 'user-5');
  assert.strictEqual(r6.allowed, true, 'User 5 from different IPv6 subnet should be allowed');
  console.log('✔ IPv6 different subnet login verified');

  // Test 4.7: IPv6 allowlisted user bypass
  allowlistRecords.push({ ipAddress: '2a01:cb08:834:100:0000:0000:0000:0001', userId: 'user-6' });
  const r7 = await ipCheck.checkAndRecordIp('2a01:cb08:834:100:ffff:eeee:dddd:cccc', 'discord-user-6', 'user-6');
  assert.strictEqual(r7.allowed, true, 'Allowlisted IPv6 user should bypass check');
  assert.strictEqual(r7.allowlistBypassed, true);
  console.log('✔ IPv6 allowlist bypass verified');

  console.log('ALL TESTS PASSED SUCCESSFULLY!');
})();

console.log('--- 5. Testing areIpsEquivalent in session scenarios ---');
// Session IP check: rotating IPv6 temporary host address within same /64
const sessionIp1 = '2a01:cb08:834:100:aaaa:bbbb:cccc:dddd';
const rotatedSessionIp1 = '2a01:cb08:834:100:1111:2222:3333:4444';
const differentSubnetSessionIp = '2a01:cb08:999:200:aaaa:bbbb:cccc:dddd';

assert.strictEqual(areIpsEquivalent(sessionIp1, rotatedSessionIp1), true, 'Same /64 must be equivalent in session');
assert.strictEqual(areIpsEquivalent(sessionIp1, differentSubnetSessionIp), false, 'Different /64 must NOT be equivalent in session');
console.log('✔ Session IP equivalent logic verified');
