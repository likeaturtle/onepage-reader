'use strict';

/**
 * The mini program must claim a device's authenticated `did` for the logged-in
 * account before syncing. A 409 means another account owns it; the page must
 * show that and drop the BLE link instead of importing/exporting cloud data.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const pagePath = path.join(__dirname, '..', 'pages', 'index', 'index.js');
const blePath = require.resolve('../utils/ble');
const apiPath = require.resolve('../utils/api');
const authPath = require.resolve('../utils/auth');
const deviceSyncPath = require.resolve('../utils/device-sync');

const HELLO = {
  ev: 'hello',
  proto: 3,
  fw: '1.2.0',
  name: '墨程CalCal',
  pid: 'A1B2C3D4E5F6',
  did: '0123456789abcdef0123456789abcdef',
};

function makePage(options = {}) {
  let definition = null;
  const calls = { claim: [], disconnect: 0, modals: [], toasts: [] };

  global.Page = (value) => { definition = value; };
  global.wx = {
    showToast(opts) { calls.toasts.push(opts.title); },
    showModal(opts) { calls.modals.push(opts); },
    reLaunch() {},
    switchTab() {},
  };

  require.cache[blePath] = {
    id: blePath,
    filename: blePath,
    loaded: true,
    exports: {
      onState() { return () => {}; },
      onMessage() { return () => {}; },
      connect: async () => HELLO,
      disconnect: async () => { calls.disconnect += 1; },
      isConnected: () => false,
    },
  };
  require.cache[apiPath] = {
    id: apiPath,
    filename: apiPath,
    loaded: true,
    exports: {
      claimDevice(did, name, pid) {
        calls.claim.push({ did, name, pid });
        if (options.claimError) return Promise.reject(options.claimError);
        return Promise.resolve({ device: { did, pid, name } });
      },
    },
  };
  require.cache[authPath] = {
    id: authPath,
    filename: authPath,
    loaded: true,
    exports: {
      get: () => ({ token: 'token', user: {} }),
      getToken: () => 'token',
      getUser: () => ({}),
      isLoggedIn: () => true,
      setUser() {},
    },
  };
  delete require.cache[deviceSyncPath];
  delete require.cache[pagePath];
  require(pagePath);

  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch, callback) {
      for (const key of Object.keys(patch)) {
        if (key.indexOf('.') < 0) {
          this.data[key] = patch[key];
          continue;
        }
        const [head, tail] = key.split('.');
        this.data[head] = Object.assign({}, this.data[head], { [tail]: patch[key] });
      }
      if (typeof callback === 'function') callback();
    },
  });
  page.data.loggedIn = true;
  page.calls = calls;
  return page;
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('a successful BLE auth claims the did for the logged-in account', async () => {
  const page = makePage();
  page.connect({ currentTarget: { dataset: { id: 'device-1' } } });
  await tick();
  await tick();

  assert.deepEqual(page.calls.claim, [{
    did: HELLO.did,
    name: '墨程CalCal',
    pid: HELLO.pid,
  }]);
  assert.equal(page.data.hello.did, HELLO.did);
  assert.equal(page.data.error, '');
  assert.equal(page.calls.disconnect, 0);
});

test('a 409 claim shows the ownership error and disconnects without syncing', async () => {
  const error = new Error('设备已绑定其他账号');
  error.status = 409;
  const page = makePage({ claimError: error });
  page.connect({ currentTarget: { dataset: { id: 'device-1' } } });
  await tick();
  await tick();

  assert.equal(page.data.error, '该设备已绑定其他微信账号');
  assert.equal(page.calls.disconnect, 1);
  assert.equal(page.calls.modals.length, 1);
  assert.match(page.calls.modals[0].title, /绑定/);
  assert.equal(page.data.connecting, false);
});
