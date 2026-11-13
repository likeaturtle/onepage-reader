'use strict';

const WECHAT_SESSION_URL = 'https://api.weixin.qq.com/sns/jscode2session';

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  err.expose = true;
  return err;
}

/**
 * Exchange a wx.login() code for the user's openid.
 * https://developers.weixin.qq.com/miniprogram/dev/api-backend/open-api/login/auth.code2Session.html
 */
async function exchangeCode(config, code) {
  if (!config.wxAppId || !config.wxSecret) {
    throw httpError(503, '服务端未配置 WX_APPID / WX_SECRET，无法使用微信登录');
  }

  const url = new URL(WECHAT_SESSION_URL);
  url.searchParams.set('appid', config.wxAppId);
  url.searchParams.set('secret', config.wxSecret);
  url.searchParams.set('js_code', code);
  url.searchParams.set('grant_type', 'authorization_code');

  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  } catch (err) {
    throw httpError(502, '微信登录服务连接失败，请稍后重试');
  }
  if (!response.ok) {
    throw httpError(502, '微信登录服务返回异常');
  }

  let data;
  try {
    data = await response.json();
  } catch (_) {
    throw httpError(502, '微信登录服务返回了无法解析的数据');
  }

  if (data.errcode) {
    if (data.errcode === 40029 || data.errcode === 40163) {
      throw httpError(401, '登录凭证已失效，请重新登录');
    }
    if (data.errcode === 45011) {
      throw httpError(429, '登录太频繁，请稍后再试');
    }
    if (data.errcode === 40013 || data.errcode === 40125) {
      throw httpError(500, '服务端 AppID / Secret 配置不正确');
    }
    throw httpError(502, `微信登录失败（${data.errcode}）`);
  }
  if (!data.openid) {
    throw httpError(502, '微信登录未返回 openid');
  }

  return data;
}

module.exports = { exchangeCode, httpError };
