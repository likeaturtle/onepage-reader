import { phone, slot, panel, shareCard, chat, board, frameCss } from './frame.mjs';

const avatar = (txt) => `<span class="a-avatar">${txt}</span>`;

const events = [
  { t: '09:00', title: '周会', note: '5 楼小会议室' },
  { t: '14:00', title: '设计评审', note: '带上打印稿' },
  { t: '19:30', title: '英语听力', note: '第 4 单元' },
];

const dayRow = (d, wd, label, list, today = false) => `
<div class="a-day">
  <div class="a-day-head">
    <span class="a-day-num ${today ? 'on' : ''}">${d}</span>
    <span class="a-day-wd">${wd}${label ? ` · ${label}` : ''}</span>
    <span class="a-day-count">${list.length} 条</span>
  </div>
  ${list.map((e) => `<div class="a-ev">
    <span class="a-time">${e.t}</span>
    <div class="a-ev-main"><b>${e.title}</b>${e.note ? `<span>${e.note}</span>` : ''}</div>
    <span class="a-ev-act">编辑<i>删除</i></span>
  </div>`).join('')}
</div>`;

const login = (logo) => phone({
  page: 'pages/login/login', nav: 'custom', tab: '', screenClass: 'a-screen',
  content: `<div class="a-login">
    <img class="a-mark" src="${logo}" alt="">
    <div class="a-login-brand">墨程CalCal</div>
    <div class="a-login-tag">把日程写进墨水屏</div>
    <div class="a-login-mid">
      <div class="a-hair"></div>
      <p>登录后开始连接设备。用微信身份识别你的账号，日程会同时保存在云端，没带设备也能看。</p>
    </div>
    <div class="a-login-foot">
      <div class="a-cta">微信一键登录</div>
      <p class="a-login-note">首次在真机上使用时，请允许微信访问蓝牙。登录状态保存在本机，可在「我的」中退出。</p>
      <div class="a-login-api">接口 calcal.acenova.tech</div>
    </div>
  </div>`,
});

const add = (logo) => phone({
  page: 'pages/index/index', title: '墨程CalCal', tab: '添加', screenClass: 'a-screen',
  content: `<div class="a-add">
    <div class="a-today">
      <div>
        <div class="a-kicker">今天 · 周一</div>
        <div class="a-today-row"><span class="a-big">23</span><span class="a-month-side">十一月<br>2026</span></div>
      </div>
      <div class="a-me">林</div>
    </div>

    <div class="a-device">
      <span class="a-dot"></span><span class="a-dev-name">墨程CalCal</span><span class="a-dev-state">已连接</span>
      <span class="a-dev-actions"><i>同步</i><i>休眠</i><i class="danger">断开</i></span>
    </div>

    <div class="a-block">
      <div class="a-block-head"><span>说一句</span><span class="a-hint">AI 填好，核对后保存</span></div>
      <p class="a-voice-text">明天下午三点项目评审，会议室 A，带上打印稿</p>
      <div class="a-voice-row">
        <span class="a-hold"><span class="a-mic"></span>按住 说话</span>
        <span class="a-parse">解析日程</span>
      </div>
    </div>

    <div class="a-block a-form">
      <div class="a-block-head"><span>日程</span><span class="a-hint">已按语音填好</span></div>
      <div class="a-field"><span class="a-label">日期</span><span class="a-value">11月24日 周二</span></div>
      <div class="a-field"><span class="a-label">时间</span><span class="a-value num">15:00 — 16:00</span></div>
      <div class="a-field"><span class="a-label">标题</span><span class="a-value strong">项目评审</span><span class="a-count">12/95</span></div>
      <div class="a-field"><span class="a-label">备注</span><span class="a-value">会议室 A · 带上打印稿</span><span class="a-count">30/191</span></div>
      <div class="a-save">保存日程</div>
    </div>
    <div class="a-log">查看蓝牙协议日志</div>
  </div>`,
});

const agenda = () => phone({
  page: 'pages/calendar/calendar', title: '墨程CalCal', tab: '日程', screenClass: 'a-screen',
  content: `<div class="a-agenda">
    <div class="a-month">
      <div>
        <div class="a-kicker">2026</div>
        <div class="a-month-name">十一月</div>
      </div>
      <div class="a-month-nav"><span>${'<'}</span><span>${'>'}</span></div>
    </div>
    <div class="a-month-meta"><span>6 条日程</span><span>云端 · 已同步</span></div>
    ${dayRow(23, '周一', '今天', events, true)}
    ${dayRow(24, '周二', '', [
      { t: '10:00', title: '客户电话', note: '' },
      { t: '15:00', title: '项目评审', note: '会议室 A' },
    ])}
    ${dayRow(26, '周四', '', [{ t: '18:00', title: '牙医复诊', note: '口腔医院 3 楼' }])}
  </div>`,
});

const profile = () => phone({
  page: 'pages/profile/profile', title: '墨程CalCal', tab: '我的', screenClass: 'a-screen',
  content: `<div class="a-profile">
    <div class="a-profile-head">
      ${avatar('林')}
      <div class="a-profile-id"><div class="a-name">林屿</div><div class="a-uid">用户 ID u_7f3a9c21</div></div>
      <span class="a-save-link">保存</span>
    </div>

    <div class="a-section">我的设备</div>
    <div class="a-device-item">
      <div><b>墨程CalCal</b><span>绑定于 2026-11-09 · 固件 1.0.0</span></div>
      <i>解绑</i>
    </div>

    <div class="a-section">信息</div>
    <div class="a-kv"><span>应用</span><span>墨程CalCal</span></div>
    <div class="a-kv"><span>登录方式</span><span>微信登录</span></div>
    <div class="a-kv"><span>接口地址</span><span class="mono">calcal.acenova.tech</span></div>
    <div class="a-kv"><span>客户端版本</span><span>体验版</span></div>
    <div class="a-kv"><span>设备协议</span><span>proto 3</span></div>

    <div class="a-section">关于设备归属</div>
    <p class="a-note">登录用于账号归属和云端日程。日程保存在云端，连接设备后自动双向同步，设备端删除也会同步删除云端对应日程；解绑只解除云端归属，不清除设备密钥。</p>
    <div class="a-logout">退出登录</div>
  </div>`,
});

/* ---------------- panels ---------------- */

const weeks = ['日', '一', '二', '三', '四', '五', '六'];
const cells = [];
for (let i = 0; i < 35; i += 1) {
  const d = i + 1;
  if (d > 30) cells.push('<span class="a-cal-cell out"></span>');
  else {
    const cls = d === 24 ? 'sel' : d === 23 ? 'today' : '';
    cells.push(`<span class="a-cal-cell ${cls}"><span>${d}</span></span>`);
  }
}

const calendarCrop = () => `<div class="a-crop">
  <div class="a-crop-top"><span class="a-kicker">添加日程</span><span class="a-hint">11月24日 周二</span></div>
  <div class="a-cal">
    <div class="a-cal-head">
      <span class="a-cal-nav">&lsaquo;</span>
      <span class="a-cal-label">2026 年 11 月</span>
      <span class="a-cal-nav">&rsaquo;</span>
      <span class="a-cal-today">今天</span>
    </div>
    <div class="a-cal-week">${weeks.map((w) => `<span>${w}</span>`).join('')}</div>
    <div class="a-cal-grid">${cells.join('')}</div>
  </div>
  <div class="a-crop-fields">
    <div class="a-field"><span class="a-label">已选</span><span class="a-value">11月24日 周二 · 15:00</span></div>
  </div>
</div>`;

const pairingCrop = () => `<div class="a-pair-scene">
  <div class="a-crop-dim">
    <div class="a-crop-top"><span class="a-kicker">设备</span><span class="a-hint">未连接</span></div>
    <p class="a-dim-copy">扫描前请先唤醒设备；首次使用请长按设备确认键 3 秒。</p>
    <div class="a-dim-line"></div><div class="a-dim-line short"></div>
  </div>
  <div class="a-modal">
    <div class="a-modal-title">设备配对</div>
    <div class="a-modal-label">配对码</div>
    <div class="a-modal-input">K7Q4 M2X9 B3TF</div>
    <div class="a-modal-hint">屏幕上的 12 位配对码，不区分大小写</div>
    <div class="a-modal-actions"><span class="a-modal-cancel">取消</span><span class="a-modal-ok">配对</span></div>
  </div>
</div>`;

const spec = () => `<div class="a-spec">
  <div class="a-spec-title">纸与线</div>
  <div class="a-spec-row"><span class="a-spec-label">日期</span><span class="a-spec-64">23</span><span class="a-spec-note">64 / 300</span></div>
  <div class="a-spec-row"><span class="a-spec-label">页面标题</span><span class="a-spec-34">十一月</span><span class="a-spec-note">34 / 300</span></div>
  <div class="a-spec-row"><span class="a-spec-label">正文</span><span class="a-spec-15">明天下午三点项目评审</span><span class="a-spec-note">15 / 400</span></div>
  <div class="a-spec-row"><span class="a-spec-label">标签</span><span class="a-spec-11">已连接 · 云端 · 6 条</span><span class="a-spec-note">11 / 400</span></div>
  <div class="a-spec-hair"></div>
  <div class="a-spec-grid">
    <div><span class="a-swatch" style="background:#FBFAF6"></span><b>纸</b><i>#FBFAF6</i></div>
    <div><span class="a-swatch" style="background:#17181A"></span><b>墨</b><i>#17181A</i></div>
    <div><span class="a-swatch" style="background:#1E3050"></span><b>藏青</b><i>#1E3050</i></div>
    <div><span class="a-swatch" style="background:#DDD7C9"></span><b>线</b><i>#DDD7C9</i></div>
  </div>
  <div class="a-spec-foot">版心 28 · 留白 ≥55% · 一个实心墨条</div>
</div>`;

const shareArt = (logo) => `<div class="a-share-art">
  <div class="a-share-top"><img src="${logo}" alt=""><span>11 / 23</span></div>
  <div class="a-share-copy"><b>把日程<br>写进墨水屏</b><span>墨程CalCal · 微信小程序</span></div>
</div>`;

export function dirA(logo) {
  const body = `
  ${slot({ x: 56, y: 400, scale: 0.76, label: '登录', note: '自定义导航 · 一键登录', node: login(logo) })}
  ${slot({ x: 384, y: 370, scale: 0.84, label: '添加', note: '日期抬头 · 语音 · 四行表单', node: add(logo) })}
  ${slot({ x: 744, y: 400, scale: 0.76, label: '日程', note: '按天分节 · 细线表格', node: agenda() })}
  ${slot({ x: 1072, y: 400, scale: 0.76, label: '我的', note: '账号 · 设备 · 归属说明', node: profile() })}
  ${panel({ x: 56, y: 1120, w: 375, h: 380, label: '日期选择 · 1:1', note: '月历点选，选中日实心', node: calendarCrop() })}
  ${panel({ x: 463, y: 1120, w: 375, h: 380, label: '配对弹层 · 1:1', note: '12 位码，等宽字', node: pairingCrop() })}
  ${panel({ x: 870, y: 1120, w: 400, h: 380, label: '字阶与色板', note: '纸、墨、藏青、线', node: spec() })}
  <div class="a-share" style="left:1104px;top:44px">
    <div class="a-share-label">转发卡片 · 5:4</div>
    ${chat({ children: shareCard({ title: '把日程写进墨水屏', artwork: shareArt(logo), icon: `<img src="${logo}" alt="">` }) })}
  </div>
  <div class="a-board-rule"></div>`;

  const html = board({
    title: '一张纸',
    kicker: '方向一 · 最佳设计师｜原研哉',
    lede: '把小程序当成一页纸：日期是抬头，日程是表格，可点的只有一个实心墨条。设备端印出来的，是这一页的另一份。',
    meta: '<b>form 来自</b> 日程本的纸页与墨线 · <b>主入口</b> 最近使用，打开就是今天 · <b>借的</b> 留白承担结构，而不是装饰',
    body,
    cls: 'a-board',
  });
  return html.replace('__CSS__', frameCss + css);
}

const css = `
.a-board .board{height:1520px;}
.a-board{--paper:#FBFAF6;--ink:#17181A;--muted:#6F6B61;--faint:#9A9487;--line:#DDD7C9;
  --navy:#1E3050;--nav-bg:#FBFAF6;--nav-fg:#17181A;--tab-bg:#FBFAF6;--tab-on:#1E3050;--tab-dim:#B5AE9F;--tab-border:#E8E3D7;
  --fg:#1B1C1E;--label:#4C4A44;--label-dim:#8B8578;
  background:#E9E4D8;height:1520px;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;}
.a-board .board-head h1{font-weight:200;font-size:62px;letter-spacing:.06em;margin-top:6px;}
.a-board .board-kicker{color:#8B8578;}
.a-board-rule{position:absolute;left:56px;right:56px;top:236px;height:1px;background:#D3CCBD;z-index:0;}
.a-board .board-meta{max-width:540px;color:#9A9487;}
.a-board .board-meta b{color:#6F6B61;}

.a-screen{--paper:#FBFAF6;}
.a-mark{display:block;width:78px;height:78px;}
.a-login{height:100%;padding:100px 28px 30px;display:flex;flex-direction:column;}
.a-login-brand{margin-top:24px;font-size:35px;font-weight:300;letter-spacing:.02em;color:#17181A;}
.a-login-tag{margin-top:10px;font-size:12px;letter-spacing:.3em;color:#8B8578;}
.a-login-mid{margin-top:52px;}
.a-hair{height:1px;background:#DDD7C9;}
.a-login-mid p{margin:22px 0 0;font-size:15px;line-height:2;color:#4E4B45;max-width:290px;}
.a-login-foot{margin-top:auto;}
.a-cta{height:52px;background:#1E3050;color:#fff;font-size:15px;letter-spacing:.12em;display:flex;align-items:center;justify-content:center;border-radius:2px;}
.a-login-note{margin:14px 0 0;font-size:11.5px;line-height:1.9;color:#9A9487;}
.a-login-api{margin-top:26px;text-align:center;font-size:9.5px;letter-spacing:.02em;color:#B3AC9D;}

.a-add{padding:20px 28px 24px;}
.a-today{display:flex;align-items:flex-start;justify-content:space-between;padding-bottom:18px;}
.a-kicker{font-size:12px;letter-spacing:.16em;color:#8B8578;}
.a-today-row{display:flex;align-items:flex-end;gap:10px;margin-top:4px;}
.a-big{font-size:64px;font-weight:200;line-height:.9;letter-spacing:-.01em;color:#17181A;font-feature-settings:"tnum";}
.a-month-side{font-size:10.5px;line-height:1.5;color:#8B8578;padding-bottom:4px;letter-spacing:.06em;}
.a-me{width:32px;height:32px;border-radius:50%;border:1px solid #DDD7C9;display:flex;align-items:center;justify-content:center;font-size:12px;color:#4E4B45;margin-top:6px;}
.a-device{display:flex;align-items:center;gap:8px;height:40px;border-top:1px solid #DDD7C9;border-bottom:1px solid #DDD7C9;}
.a-dot{width:6px;height:6px;border-radius:50%;background:#2C8A6F;flex:none;}
.a-dev-name{font-size:12.5px;color:#17181A;}
.a-dev-state{font-size:11px;color:#1E3050;letter-spacing:.04em;}
.a-dev-actions{margin-left:auto;display:flex;gap:11px;font-size:11.5px;color:#6F6B61;}
.a-dev-actions i{font-style:normal;}
.a-dev-actions i.danger{color:#9C3427;}
.a-block{margin-top:20px;}
.a-block-head{display:flex;align-items:baseline;justify-content:space-between;padding-bottom:8px;border-bottom:1px solid #DDD7C9;}
.a-block-head span:first-child{font-size:11px;letter-spacing:.16em;color:#6F6B61;}
.a-hint{font-size:11.5px;color:#A39C8D;}
.a-voice-text{margin:12px 0 0;font-size:14px;line-height:1.75;color:#17181A;}
.a-voice-row{display:flex;align-items:center;gap:14px;margin-top:12px;}
.a-hold{flex:1;height:44px;border:1px solid #17181A;border-radius:2px;display:flex;align-items:center;justify-content:center;gap:8px;font-size:13px;letter-spacing:.08em;color:#17181A;}
.a-mic{width:6px;height:6px;border-radius:50%;background:#9C3427;}
.a-parse{font-size:11.5px;color:#1E3050;border-bottom:1px solid #1E3050;padding-bottom:2px;flex:none;}
.a-form .a-field{display:flex;align-items:center;height:42px;border-bottom:1px solid #E7E2D6;}
.a-label{width:38px;flex:none;font-size:11px;color:#9A9487;letter-spacing:.08em;}
.a-value{font-size:14px;color:#17181A;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.a-value.num{font-feature-settings:"tnum";letter-spacing:.02em;}
.a-value.strong{font-weight:600;}
.a-count{margin-left:auto;font-size:11px;color:#B3AC9D;padding-left:10px;flex:none;}
.a-save{margin-top:22px;height:52px;background:#1E3050;border-radius:2px;color:#fff;font-size:15px;letter-spacing:.14em;display:flex;align-items:center;justify-content:center;}

.a-agenda{padding:18px 28px 24px;}
.a-month{display:flex;align-items:flex-end;justify-content:space-between;}
.a-month-name{font-size:34px;font-weight:300;line-height:1.1;color:#17181A;letter-spacing:.02em;}
.a-month-nav{display:flex;gap:0;color:#5C5850;}
.a-month-nav span{width:40px;height:40px;display:flex;align-items:center;justify-content:center;font-size:19px;color:#4E4B45;}
.a-month-meta{display:flex;justify-content:space-between;margin-top:10px;padding-bottom:10px;border-bottom:1px solid #17181A;font-size:10.5px;color:#6F6B61;letter-spacing:.04em;}
.a-day{margin-top:20px;}
.a-day-head{display:flex;align-items:baseline;gap:10px;padding-bottom:6px;}
.a-day-num{font-size:30px;font-weight:300;line-height:1;color:#17181A;font-feature-settings:"tnum";}
.a-day-num.on{color:#1E3050;font-weight:400;}
.a-day-wd{font-size:11.5px;color:#8B8578;letter-spacing:.06em;}
.a-day-count{margin-left:auto;font-size:11px;color:#B3AC9D;}
.a-ev{display:flex;align-items:flex-start;gap:12px;padding:11px 0;border-top:1px solid #E7E2D6;}
.a-time{width:44px;flex:none;font-size:12px;color:#6F6B61;font-feature-settings:"tnum";letter-spacing:.02em;padding-top:2px;}
.a-ev-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px;}
.a-ev-main b{font-size:14px;font-weight:500;color:#17181A;line-height:1.35;}
.a-ev-main span{font-size:11.5px;color:#8B8578;line-height:1.4;}
.a-ev-act{flex:none;font-size:11px;color:#A39C8D;display:flex;gap:6px;}
.a-ev-act i{font-style:normal;color:#9C3427;}

.a-profile{padding:16px 28px 24px;display:flex;flex-direction:column;min-height:100%;}
.a-profile-head{display:flex;align-items:center;gap:14px;padding-bottom:16px;border-bottom:1px solid #17181A;}
.a-avatar{width:56px;height:56px;border-radius:50%;border:1px solid #DDD7C9;display:flex;align-items:center;justify-content:center;font-size:19px;color:#4E4B45;flex:none;}
.a-name{font-size:20px;font-weight:500;color:#17181A;letter-spacing:.02em;}
.a-uid{margin-top:4px;font-size:11px;color:#9A9487;letter-spacing:.02em;}
.a-save-link{margin-left:auto;font-size:11px;color:#1E3050;border-bottom:1px solid #1E3050;padding-bottom:2px;}
.a-section{margin-top:16px;font-size:10.5px;letter-spacing:.16em;color:#6F6B61;padding-bottom:8px;border-bottom:1px solid #DDD7C9;}
.a-device-item{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:9px 0;}
.a-device-item b{display:block;font-size:13.5px;font-weight:500;}
.a-device-item span{display:block;margin-top:4px;font-size:11px;color:#9A9487;}
.a-device-item i{font-style:normal;font-size:10.5px;color:#9C3427;flex:none;}
.a-kv{display:flex;justify-content:space-between;gap:14px;padding:7px 0;border-bottom:1px solid #EFEAE0;font-size:12px;}
.a-kv span:first-child{color:#8B8578;flex:none;}
.a-kv span:last-child{text-align:right;color:#17181A;}
.a-kv .mono{font-family:Menlo,monospace;font-size:10px;letter-spacing:-.01em;}
.a-note{margin:10px 0 0;font-size:11.5px;line-height:1.9;color:#8B8578;}
.a-log{margin-top:16px;text-align:center;font-size:11px;color:#A39C8D;letter-spacing:.06em;}
.a-logout{margin-top:auto;padding-top:16px;border-top:1px solid #EFEAE0;text-align:center;font-size:11.5px;color:#9C3427;letter-spacing:.08em;}

/* crop panels */
.panel-body{background:#FBFAF6;}
.a-crop{padding:20px 24px;height:380px;}
.a-crop-top{display:flex;align-items:baseline;justify-content:space-between;padding-bottom:12px;border-bottom:1px solid #17181A;}
.a-cal{margin-top:16px;}
.a-cal-head{display:flex;align-items:center;gap:6px;}
.a-cal-nav{width:30px;height:30px;display:flex;align-items:center;justify-content:center;font-size:18px;color:#6F6B61;}
.a-cal-label{flex:1;text-align:center;font-size:12px;letter-spacing:.06em;color:#17181A;}
.a-cal-today{font-size:9.5px;color:#1E3050;border:1px solid #C9D1DF;padding:4px 8px;border-radius:2px;}
.a-cal-week{display:flex;margin-top:8px;}
.a-cal-week span{width:14.2857%;text-align:center;font-size:10px;color:#9A9487;letter-spacing:.06em;}
.a-cal-grid{display:flex;flex-wrap:wrap;margin-top:4px;}
.a-cal-cell{width:14.2857%;height:33px;display:flex;align-items:center;justify-content:center;}
.a-cal-cell span{width:28px;height:27px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;color:#17181A;font-feature-settings:"tnum";}
.a-cal-cell.today span{border:1px solid #A9B4C8;color:#1E3050;}
.a-cal-cell.sel span{background:#1E3050;color:#fff;}
.a-cal-cell.out span{color:#CFC9BB;}
.a-crop-fields{margin-top:10px;}
.a-crop-fields .a-field{display:flex;align-items:center;height:40px;border-bottom:1px solid #E7E2D6;}

.a-pair-scene{position:relative;height:380px;background:#FBFAF6;}
.a-crop-dim{padding:20px 24px;opacity:.28;}
.a-dim-copy{font-size:12px;line-height:1.8;margin:14px 0;color:#17181A;}
.a-dim-line{height:1px;background:#17181A;margin-top:20px;}
.a-dim-line.short{width:60%;}
.a-modal{position:absolute;left:34px;right:34px;top:74px;background:#FBFAF6;border:1px solid #17181A;border-radius:2px;padding:22px 20px 18px;box-shadow:10px 12px 0 rgba(23,24,26,.06);}
.a-modal-title{font-size:17px;font-weight:500;letter-spacing:.06em;}
.a-modal-label{margin-top:20px;font-size:9.5px;letter-spacing:.16em;color:#8B8578;}
.a-modal-input{margin-top:8px;height:44px;border:1px solid #1E3050;border-radius:2px;display:flex;align-items:center;padding:0 12px;font-family:Menlo,monospace;font-size:14px;letter-spacing:.12em;color:#17181A;}
.a-modal-hint{margin-top:8px;font-size:9.5px;color:#9A9487;}
.a-modal-actions{display:flex;gap:10px;margin-top:20px;}
.a-modal-cancel,.a-modal-ok{flex:1;height:42px;display:flex;align-items:center;justify-content:center;font-size:12.5px;border-radius:2px;letter-spacing:.1em;}
.a-modal-cancel{border:1px solid #DDD7C9;color:#4E4B45;}
.a-modal-ok{background:#1E3050;color:#fff;}

.a-spec{padding:22px 24px;height:380px;}
.a-spec-title{font-size:12px;letter-spacing:.16em;color:#6F6B61;}
.a-spec-row{display:flex;align-items:baseline;gap:10px;padding:9px 0;border-bottom:1px solid #EFEAE0;}
.a-spec-label{width:52px;flex:none;font-size:9.5px;color:#9A9487;}
.a-spec-64{font-size:64px;font-weight:200;line-height:.8;letter-spacing:-.02em;}
.a-spec-34{font-size:34px;font-weight:300;line-height:1;letter-spacing:.02em;}
.a-spec-15{font-size:15px;line-height:1.4;}
.a-spec-11{font-size:11px;color:#6F6B61;}
.a-spec-note{margin-left:auto;font-size:8.5px;color:#B3AC9D;font-feature-settings:"tnum";}
.a-spec-hair{height:1px;background:#17181A;margin-top:16px;}
.a-spec-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:16px;}
.a-spec-grid div{display:flex;flex-direction:column;gap:5px;}
.a-swatch{height:44px;border:1px solid #E1DBCC;display:block;}
.a-spec-grid b{font-size:9.5px;font-weight:500;color:#4E4B45;}
.a-spec-grid i{font-style:normal;font-size:8px;color:#A39C8D;letter-spacing:.02em;}
.a-spec-foot{margin-top:18px;font-size:9px;color:#A39C8D;letter-spacing:.04em;}

/* share */
.a-share{position:absolute;z-index:2;}
.a-share-label{font-size:11px;letter-spacing:.12em;color:#8B8578;margin-bottom:10px;}
.a-share-art{width:220px;height:176px;background:#FBFAF6;padding:16px 18px;display:flex;flex-direction:column;justify-content:space-between;}
.a-share-top{display:flex;align-items:flex-start;justify-content:space-between;}
.a-share-top span{font-size:10px;color:#8B8578;letter-spacing:.12em;font-feature-settings:"tnum";}
.a-share-art img{width:38px;height:38px;display:block;}
.a-share-copy b{display:block;font-size:21px;font-weight:400;line-height:1.35;letter-spacing:.02em;color:#17181A;}
.a-share-copy span{display:block;margin-top:8px;font-size:9px;letter-spacing:.14em;color:#8B8578;}
`;
