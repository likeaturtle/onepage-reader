'use strict';

const auth = require('./utils/auth');

App({
  globalData: {
    user: null,
  },

  onLaunch() {
    const session = auth.get();
    this.globalData.user = session ? session.user : null;
  },

  setUser(user) {
    this.globalData.user = user;
    if (user) auth.setUser(user);
  },
});
