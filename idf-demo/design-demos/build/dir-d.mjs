import { phone, slot, panel, shareCard, chat, board, frameCss } from './frame.mjs';

const events = [
  { t: '09:00', title: '周会', note: '5 楼小会议室' },
  { t: '14:00', title: '设计评审', note: '带上打印稿' },
  { t: '19:30', title: '英语听力', note: '第 4 单元' },
];

const ruler = (sel = 0) => Array.from({ length: 30 }, (_, i) => {
  const d = i + 1;
  const cls = [d === 23 ? 'today' : '', [23, 24, 26, 28].includes(d) ? 'ev' : '', d === sel ? 'sel' : ''].filter(Boolean).join(' ');
  return `<span class="k-tick ${cls}"></span>`;
}).join('');

const dayRow = (d, wd, count, list, today = false) => `
<div class="k-day">
  <div class="k-day-head"><span class="k-day-num ${today ? 'today' : ''}">${d}</span><span class="k-day-wd">${wd}${today ? ' · 今天' : ''}</span><span class="k-day-count">${count} 条</span></div>
  ${list.map((e) => `<div class="k-ev">
    <span class="k-time">${e.t}</span>
    <div class="k-ev-main"><b>${e.title}</b>${e.note ? `<span>${e.note}</span>` : ''}</div>
    <span class="k-ev-act">编辑<i>删除</i></span>
  </div>`).join('')}
</div>`;

const login = (logo) => phone({
  page: 'pages/login/login', nav: 'custom', screenClass: 'k-screen',
  content: `<div class="k-login">
    <img class="k-mark" src="${logo}" alt="">
    <div class="k-brand">墨程CalCal</div>
    <div class="k-vside"><span class="k-vline"></span><span class="k-vtext">把日程写进墨水屏</span><span class="k-vdot"></span></div>
    <p class="k-copy">登录后开始连接设备。用微信身份识别你的账号，日程会同时保存在云端，没带设备也能看。</p>
    <div class="k-login-foot">
      <div class="k-cta">微信一键登录</div>
      <p class="k-note">首次在真机上使用时，请允许微信访问蓝牙。登录状态保存在本机，可在「我的」中退出。</p>
      <div class="k-api">接口 calcal.acenova.tech</div>
    </div>
  </div>`,
});

const add = () => phone({
  page: 'pages/index/index', title: '墨程CalCal', tab: '添加', screenClass: 'k-screen',
  content: `<div class="k-add">
    <div class="k-ruler-head"><span>十一月</span><span>2026</span></div>
    <div class="k-ruler">${ruler(24)}</div>
    <div class="k-ruler-labels"><span>1</span><span class="today">23 今天</span><span>30</span></div>

    <div class="k-title-row">
      <div><span class="k-big">24</span><span class="k-wd">周二 · 新日程</span></div>
      <span class="k-dev"><i></i>已连接</span>
    </div>
    <div class="k-device"><b>墨程CalCal</b><span>固件 1.0.0 · 12 条</span><i>同步</i><i>休眠</i><i class="danger">断开</i></div>

    <div class="k-voice">
      <div class="k-sec"><span>说一句</span><em>AI 填好，核对后保存</em></div>
      <p>明天下午三点项目评审，会议室 A，带上打印稿</p>
      <div class="k-voice-row"><span class="k-hold"><i></i>按住 说话</span><span class="k-parse">解析日程</span></div>
    </div>

    <div class="k-timebar">
      <div class="k-tb-head"><span>时间</span><b>15:00 — 16:00</b><em>1 小时</em></div>
      <div class="k-tb-line"><i style="left:62.5%;width:4.17%"></i></div>
      <div class="k-tb-scale"><span>0</span><span>6</span><span>12</span><span>18</span><span>24</span></div>
    </div>

    <div class="k-fields">
      <div class="k-field"><span>标题</span><b>项目评审</b><i>12/95</i></div>
      <div class="k-field"><span>备注</span><b>会议室 A · 带上打印稿</b><i>30/191</i></div>
    </div>
    <div class="k-save">保存日程</div>
    <div class="k-log">查看蓝牙协议日志</div>
  </div>`,
});

const agenda = () => phone({
  page: 'pages/calendar/calendar', title: '墨程CalCal', tab: '日程', screenClass: 'k-screen',
  content: `<div class="k-ag">
    <div class="k-ag-head"><div><div class="k-kicker">2026</div><div class="k-month">十一月</div></div><div class="k-ag-meta">6 条日程<br>云端 · 已同步</div></div>
    <div class="k-ruler">${ruler()}</div>
    <div class="k-ruler-labels"><span>1</span><span class="today">23 今天</span><span>30</span></div>
    <div class="k-ag-rule"></div>
    ${dayRow(23, '周一', 3, events, true)}
    ${dayRow(24, '周二', 2, [
      { t: '10:00', title: '客户电话', note: '' },
      { t: '15:00', title: '项目评审', note: '会议室 A' },
    ])}
    ${dayRow(26, '周四', 1, [{ t: '18:00', title: '牙医复诊', note: '口腔医院 3 楼' }])}
  </div>`,
});

const weekTicks = Array.from({ length: 52 }, (_, i) => `<span class="k-week ${i === 47 ? 'now' : ''}"></span>`).join('');

const profile = () => phone({
  page: 'pages/profile/profile', title: '墨程CalCal', tab: '我的', screenClass: 'k-screen',
  content: `<div class="k-profile">
    <div class="k-year"><div class="k-year-head"><span>2026</span><em>第 48 周 · 已过 327 天</em></div><div class="k-weeks">${weekTicks}</div></div>

    <div class="k-prow"><span class="k-avatar">林</span><div><div class="k-name">林屿</div><div class="k-uid">用户 ID u_7f3a9c21</div></div><span class="k-save-link">保存</span></div>

    <div class="k-section">我的设备</div>
    <div class="k-devrow"><div><b>墨程CalCal</b><span>绑定于 2026-11-09 · 固件 1.0.0</span></div><i>解绑</i></div>

    <div class="k-section">信息</div>
    <div class="k-kv"><span>应用</span><span>墨程CalCal</span></div>
    <div class="k-kv"><span>登录方式</span><span>微信登录</span></div>
    <div class="k-kv"><span>接口地址</span><span class="mono">calcal.acenova.tech</span></div>
    <div class="k-kv"><span>客户端版本</span><span>体验版</span></div>
    <div class="k-kv"><span>设备协议</span><span>proto 3</span></div>

    <div class="k-section">关于设备归属</div>
    <p class="k-note-text">日程保存在云端，连接设备后自动双向同步，设备端删除也会同步删除云端对应日程。解绑只解除云端归属，不清除设备密钥。</p>
    <div class="k-logout">退出登录</div>
  </div>`,
});

/* ---------------- panels ---------------- */

const weeks = ['日', '一', '二', '三', '四', '五', '六'];
const cells = [];
for (let i = 0; i < 35; i += 1) {
  const d = i + 1;
  if (d > 30) cells.push('<span class="k-cal-cell out"></span>');
  else cells.push(`<span class="k-cal-cell ${d === 24 ? 'sel' : d === 23 ? 'today' : ''}"><span>${d}</span></span>`);
}

const rulerPanel = () => `<div class="k-rp">
  <div class="k-rp-head"><span>十一月</span><em>2026 · 6 条</em></div>
  <div class="k-rp-ruler">${Array.from({ length: 30 }, (_, i) => `<span class="k-rp-tick ${i + 1 === 23 ? 'today' : ''} ${[23, 24, 26, 28].includes(i + 1) ? 'ev' : ''}"></span>`).join('')}</div>
  <div class="k-rp-labels">${Array.from({ length: 30 }, (_, i) => `<span class="${[23, 24, 26, 28].includes(i + 1) ? 'on' : ''}">${i + 1}</span>`).join('')}</div>
  <div class="k-rp-note">位置就是日期，长度就是事件数。今天 23 是这一格里最高的红线。</div>
  <div class="k-rp-cal">
    <div class="k-cal-week">${weeks.map((w) => `<span>${w}</span>`).join('')}</div>
    <div class="k-cal-grid">${cells.join('')}</div>
  </div>
</div>`;

const pairingCrop = () => `<div class="k-pair">
  <div class="k-pair-ghost"><span>设备</span><i></i><i style="width:60%"></i></div>
  <div class="k-modal">
    <div class="k-modal-rule"></div>
    <div class="k-modal-body">
      <div class="k-modal-title">设备配对</div>
      <div class="k-modal-sub">输入设备屏幕上的 12 位配对码</div>
      <div class="k-modal-code">K7Q4 M2X9 B3TF<i></i></div>
      <div class="k-modal-hint">不区分大小写，例如 K7Q4M2X9B3TF</div>
      <div class="k-modal-actions"><span>取消</span><span class="ok">配对</span></div>
    </div>
  </div>
</div>`;

const spec = () => `<div class="k-spec">
  <div class="k-spec-title">刻度的语法</div>
  <div class="k-spec-ruler">${Array.from({ length: 30 }, (_, i) => `<span class="${i + 1 === 23 ? 'today' : ''} ${[23, 24, 26, 28].includes(i + 1) ? 'ev' : ''}"></span>`).join('')}</div>
  <div class="k-spec-row"><span>日期</span><b class="k-t56">24</b><i>宋体 56</i></div>
  <div class="k-spec-row"><span>月份</span><b class="k-t34">十一月</b><i>宋体 34</i></div>
  <div class="k-spec-row"><span>正文</span><b class="k-t14">明天下午三点项目评审</b><i>14 / 1.8</i></div>
  <div class="k-spec-row"><span>标签</span><b class="k-t12">已连接 · 云端 · 6 条</b><i>12</i></div>
  <div class="k-spec-hair"></div>
  <div class="k-spec-colors"><span style="background:#F3F1EA"></span><span style="background:#14181C"></span><span style="background:#B23A2A"></span><span style="background:#D8D4C8"></span></div>
  <div class="k-spec-caps">纸 / 墨 / 朱 / 线 · 刻度 2 px，今天 26 px</div>
</div>`;

const shareArt = (logo) => `<div class="k-share-art">
  <span class="k-share-sun"></span>
  <img src="${logo}" alt="">
  <div class="k-share-title">把日程<br>写进墨水屏</div>
  <div class="k-share-meta">十一月 · 第 48 周</div>
</div>`;

export function dirD(logo) {
  const body = `
  ${slot({ x: 56, y: 330, scale: 0.88, label: '添加', note: '月刻度 + 24 小时刻度', node: add() })}
  ${slot({ x: 440, y: 330, scale: 0.8, label: '日程', note: '位置就是日期', node: agenda() })}
  ${slot({ x: 790, y: 400, scale: 0.8, label: '我的', note: '一年 52 周，刻度到周', node: profile() })}
  ${slot({ x: 1120, y: 370, scale: 0.74, label: '登录', note: '竖排标语 + 朱线', node: login(logo) })}
  ${panel({ x: 56, y: 1120, w: 375, h: 380, label: '月刻度 · 1:1', note: '30 格，今天最高', node: rulerPanel() })}
  ${panel({ x: 463, y: 1120, w: 375, h: 380, label: '配对 · 1:1', note: '朱线 + 方角', node: pairingCrop() })}
  ${panel({ x: 870, y: 1120, w: 300, h: 380, label: '刻度语法', note: '2 px / 26 px', node: spec() })}
  <div class="k-share" style="left:1180px;top:1096px">
    <div class="k-share-label-board">转发卡片 · 5:4</div>
    ${chat({ children: shareCard({ title: '把日程写进墨水屏', artwork: shareArt(logo), icon: `<img src="${logo}" alt="">` }) })}
  </div>
  <div class="k-sun"></div>`;

  const html = board({
    title: '刻度',
    kicker: '备选 A2 · 最佳设计师｜杉浦康平',
    lede: '日历是一条有刻度的尺：一个月 30 格，位置是日期，高度是事件数，今天是一道朱线。手机端先把时间量出来，再写下去。',
    meta: '<b>form 来自</b> 墨水屏的格纸与 1 px 墨线 · <b>主入口</b> 最近使用 · <b>借的</b> 周期被画成刻度，而不是表格',
    body,
    cls: 'k-board',
  });
  return html.replace('__CSS__', frameCss + css);
}

const css = `
.k-board .board{height:1560px;}
.k-board{--paper:#F3F1EA;--ink:#14181C;--muted:#8F9088;--line:#D8D4C8;--red:#B23A2A;
  --nav-bg:#F3F1EA;--nav-fg:#14181C;--tab-bg:#F3F1EA;--tab-on:#14181C;--tab-dim:#B5B2A7;--tab-border:#E2DED2;
  --fg:#EFEADC;--label:#EFEADC;--label-dim:#9FA096;
  background:#14181C;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#EFEADC;}
.k-board .board-kicker{color:#9FA096;}
.k-board .board-head h1{font-family:"Songti SC",serif;font-weight:600;font-size:72px;color:#F2EDDF;letter-spacing:.08em;line-height:1;margin-top:8px;}
.k-board .board-lede{color:#C9C4B6;font-size:15px;max-width:600px;}
.k-board .board-meta{color:#8F9088;}
.k-board .board-meta b{color:#C9C4B6;}
.k-sun{position:absolute;right:-150px;top:140px;width:430px;height:430px;border-radius:50%;background:#B23A2A;opacity:.92;z-index:0;}
.k-board .slot,.k-board .panel,.k-board .k-share{position:absolute;z-index:2;}

.k-screen{--paper:#F3F1EA;}
.k-mark{display:block;width:64px;height:64px;}
.k-login{height:100%;padding:96px 28px 26px;position:relative;display:flex;flex-direction:column;}
.k-brand{margin-top:22px;font-size:31px;font-weight:600;letter-spacing:.03em;color:#14181C;}
.k-vside{position:absolute;right:26px;top:112px;width:40px;height:380px;}
.k-vline{position:absolute;left:0;top:0;width:1px;height:300px;background:#B23A2A;}
.k-vtext{position:absolute;left:10px;top:0;writing-mode:vertical-rl;font-size:12px;letter-spacing:.2em;color:#6E7068;line-height:1;white-space:nowrap;}
.k-vdot{position:absolute;left:-3px;top:308px;width:7px;height:7px;border-radius:50%;background:#B23A2A;}
.k-copy{margin:56px 0 0;max-width:220px;font-size:13.5px;line-height:1.95;color:#4E5149;}
.k-login-foot{margin-top:auto;}
.k-cta{height:52px;background:#14181C;color:#F3F1EA;display:flex;align-items:center;justify-content:center;font-size:15px;letter-spacing:.14em;border-radius:1px;}
.k-note{margin:14px 0 0;font-size:11.5px;line-height:1.8;color:#8F9088;}
.k-api{margin-top:20px;text-align:center;font-size:10px;color:#A8A79B;}

.k-add{padding:16px 24px 18px;}
.k-ruler-head{display:flex;justify-content:space-between;font-size:11px;letter-spacing:.14em;color:#6E7068;}
.k-ruler{display:flex;justify-content:space-between;align-items:flex-end;height:30px;margin-top:8px;}
.k-tick{width:2px;height:8px;background:#D8D4C8;display:block;}
.k-tick.ev{height:15px;background:#8D8F87;}
.k-tick.today{height:28px;background:#B23A2A;}
.k-tick.sel{background:#14181C;height:20px;}
.k-ruler-labels{position:relative;height:15px;margin-top:5px;font-size:10.5px;color:#A8A79B;font-feature-settings:"tnum";}
.k-ruler-labels span{position:absolute;top:0;}
.k-ruler-labels span:first-child{left:0;}
.k-ruler-labels span:last-child{right:0;}
.k-ruler-labels .today{left:76.7%;transform:translateX(-50%);color:#B23A2A;font-weight:500;font-size:10.5px;}
.k-title-row{display:flex;align-items:flex-end;justify-content:space-between;margin-top:12px;}
.k-big{font-family:"Songti SC",serif;font-size:52px;font-weight:600;line-height:.9;color:#14181C;font-feature-settings:"tnum";}
.k-wd{font-size:11px;color:#6E7068;margin-left:8px;letter-spacing:.04em;}
.k-dev{display:flex;align-items:center;gap:5px;font-size:10.5px;color:#6E7068;}
.k-dev i{width:5px;height:5px;border-radius:50%;background:#2C8A6F;display:block;}
.k-device{display:flex;align-items:center;gap:8px;height:36px;margin-top:8px;border-top:1px solid #14181C;border-bottom:1px solid #D8D4C8;font-size:11px;color:#8F9088;}
.k-device b{font-size:11.5px;font-weight:600;color:#14181C;}
.k-device i{margin-left:auto;font-style:normal;font-size:11px;color:#4E5149;}
.k-device i + i{margin-left:10px;}
.k-device i.danger{color:#B23A2A;}
.k-voice{margin-top:12px;}
.k-sec{display:flex;align-items:baseline;justify-content:space-between;border-bottom:1px solid #D8D4C8;padding-bottom:5px;}
.k-sec span{font-size:11px;letter-spacing:.14em;color:#6E7068;}
.k-sec em{font-style:normal;font-size:10.5px;color:#A8A79B;}
.k-voice p{margin:8px 0 0;font-size:13.5px;line-height:1.65;color:#14181C;}
.k-voice-row{display:flex;align-items:center;gap:10px;margin-top:9px;}
.k-hold{flex:1;height:40px;background:#14181C;color:#F3F1EA;display:flex;align-items:center;justify-content:center;gap:7px;font-size:12.5px;letter-spacing:.08em;border-radius:1px;}
.k-hold i{width:5px;height:5px;border-radius:50%;background:#B23A2A;display:block;}
.k-parse{font-size:11px;color:#B23A2A;border-bottom:1px solid #B23A2A;padding-bottom:2px;flex:none;}
.k-timebar{margin-top:12px;}
.k-tb-head{display:flex;align-items:baseline;gap:8px;}
.k-tb-head span{font-size:10.5px;color:#8F9088;}
.k-tb-head b{font-family:"Songti SC",serif;font-size:17px;font-weight:600;letter-spacing:.02em;}
.k-tb-head em{margin-left:auto;font-style:normal;font-size:9.5px;color:#A8A79B;}
.k-tb-line{position:relative;height:5px;background:#D8D4C8;margin-top:7px;}
.k-tb-line i{position:absolute;top:0;height:5px;background:#14181C;display:block;}
.k-tb-scale{display:flex;justify-content:space-between;margin-top:4px;font-size:8.5px;color:#A8A79B;font-feature-settings:"tnum";}
.k-fields{margin-top:12px;}
.k-field{display:flex;align-items:baseline;gap:10px;height:38px;border-bottom:1px solid #D8D4C8;}
.k-field span{width:32px;flex:none;font-size:11px;color:#8F9088;}
.k-field b{font-size:13px;font-weight:500;color:#14181C;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.k-field i{margin-left:auto;font-style:normal;font-size:10px;color:#B5B2A7;}
.k-save{margin-top:14px;height:46px;background:#14181C;color:#F3F1EA;display:flex;align-items:center;justify-content:center;font-size:14px;letter-spacing:.16em;border-radius:1px;}
.k-log{margin-top:12px;text-align:center;font-size:11px;color:#A8A79B;letter-spacing:.06em;}

.k-ag{padding:16px 24px 20px;}
.k-ag-head{display:flex;align-items:flex-end;justify-content:space-between;}
.k-kicker{font-size:10.5px;letter-spacing:.18em;color:#8F9088;}
.k-month{font-family:"Songti SC",serif;font-size:32px;font-weight:600;color:#14181C;letter-spacing:.04em;margin-top:2px;}
.k-ag-meta{font-size:11px;line-height:1.55;color:#8F9088;text-align:right;}
.k-ag .k-ruler{margin-top:14px;}
.k-ag-rule{height:3px;border-top:1px solid #14181C;border-bottom:1px solid #14181C;margin-top:14px;}
.k-day{margin-top:14px;}
.k-day-head{display:flex;align-items:baseline;gap:8px;padding-bottom:5px;}
.k-day-num{font-family:"Songti SC",serif;font-size:27px;font-weight:600;line-height:1;color:#14181C;font-feature-settings:"tnum";}
.k-day-num.today{color:#B23A2A;}
.k-day-wd{font-size:10.5px;color:#8F9088;letter-spacing:.04em;}
.k-day-wd::after{content:"";display:inline-block;width:3px;height:3px;border-radius:50%;background:currentColor;margin-left:5px;vertical-align:2px;opacity:0;}
.k-day-count{margin-left:auto;font-size:11px;color:#B5B2A7;}
.k-ev{display:flex;align-items:flex-start;gap:10px;padding:9px 0;border-top:1px solid #E4E0D5;}
.k-time{width:42px;flex:none;font-size:12px;color:#6E7068;font-feature-settings:"tnum";padding-top:2px;}
.k-ev-main{flex:1;min-width:0;}
.k-ev-main b{display:block;font-size:13.5px;font-weight:500;color:#14181C;line-height:1.35;}
.k-ev-main span{display:block;margin-top:2px;font-size:10.5px;color:#8F9088;line-height:1.4;}
.k-ev-act{flex:none;display:flex;gap:7px;font-size:11px;color:#A8A79B;}
.k-ev-act i{font-style:normal;color:#B23A2A;}

.k-profile{padding:16px 24px 22px;display:flex;flex-direction:column;min-height:100%;}
.k-year-head{display:flex;align-items:baseline;justify-content:space-between;font-size:11px;letter-spacing:.12em;color:#6E7068;}
.k-year-head em{font-style:normal;font-size:9.5px;color:#A8A79B;letter-spacing:.02em;}
.k-weeks{display:flex;justify-content:space-between;align-items:flex-end;height:22px;margin-top:6px;}
.k-week{width:2px;height:7px;background:#D8D4C8;display:block;}
.k-week.now{height:20px;background:#B23A2A;}
.k-prow{display:flex;align-items:center;gap:12px;padding:16px 0 12px;border-bottom:1px solid #14181C;}
.k-avatar{width:50px;height:50px;border-radius:50%;border:1px solid #14181C;display:flex;align-items:center;justify-content:center;font-family:"Songti SC",serif;font-size:18px;color:#14181C;flex:none;}
.k-name{font-size:19px;font-weight:600;}
.k-uid{margin-top:3px;font-size:9.5px;color:#8F9088;}
.k-save-link{margin-left:auto;font-size:10.5px;color:#B23A2A;border-bottom:1px solid #B23A2A;padding-bottom:2px;}
.k-section{margin-top:14px;padding-bottom:5px;border-bottom:1px solid #D8D4C8;font-size:10px;letter-spacing:.16em;color:#8F9088;}
.k-devrow{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:9px 0;}
.k-devrow b{font-size:12.5px;font-weight:600;}
.k-devrow span{display:block;margin-top:3px;font-size:9.5px;color:#8F9088;}
.k-devrow i{font-style:normal;font-size:10.5px;color:#B23A2A;flex:none;}
.k-kv{display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-bottom:1px solid #E9E5DA;font-size:11px;}
.k-kv span:first-child{color:#8F9088;}
.k-kv .mono{font-family:Menlo,monospace;font-size:9.5px;}
.k-note-text{margin:8px 0 0;font-size:10.5px;line-height:1.8;color:#6E7068;}
.k-logout{margin-top:auto;padding-top:12px;border-top:1px solid #E4E0D5;text-align:center;font-size:11px;color:#B23A2A;letter-spacing:.1em;}

.panel-body{background:#F3F1EA;}
.k-rp{padding:16px 18px;height:380px;}
.k-rp-head{display:flex;align-items:baseline;justify-content:space-between;}
.k-rp-head span{font-family:"Songti SC",serif;font-size:18px;font-weight:600;}
.k-rp-head em{font-style:normal;font-size:10px;color:#8F9088;}
.k-rp-ruler{display:flex;justify-content:space-between;align-items:flex-end;height:40px;margin-top:16px;}
.k-rp-tick{width:3px;height:10px;background:#D8D4C8;}
.k-rp-tick.ev{height:22px;background:#8D8F87;}
.k-rp-tick.today{height:38px;background:#B23A2A;}
.k-rp-labels{display:flex;justify-content:space-between;margin-top:4px;}
.k-rp-labels span{width:3px;text-align:center;font-size:6px;color:#B5B2A7;font-feature-settings:"tnum";}
.k-rp-labels span.on{font-size:8px;color:#14181C;}
.k-rp-note{margin-top:12px;font-size:9.5px;line-height:1.7;color:#8F9088;}
.k-rp-cal{margin-top:10px;}
.k-cal-week{display:flex;}
.k-cal-week span{width:14.2857%;text-align:center;font-size:8.5px;color:#A8A79B;}
.k-cal-grid{display:flex;flex-wrap:wrap;margin-top:3px;}
.k-cal-cell{width:14.2857%;height:26px;display:flex;align-items:center;justify-content:center;}
.k-cal-cell span{width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-family:"Songti SC",serif;font-size:10px;color:#14181C;}
.k-cal-cell.out span{color:#D3CFC3;}
.k-cal-cell.today span{border:1px solid #B23A2A;border-radius:50%;color:#B23A2A;}
.k-cal-cell.sel span{background:#14181C;color:#F3F1EA;border-radius:50%;}

.k-pair{position:relative;height:380px;background:#F3F1EA;overflow:hidden;}
.k-pair-ghost{position:absolute;left:30px;right:30px;top:30px;opacity:.18;}
.k-pair-ghost span{font-size:10px;color:#14181C;}
.k-pair-ghost i{display:block;height:1px;background:#14181C;margin-top:18px;}
.k-modal{position:absolute;left:36px;right:36px;top:64px;background:#F3F1EA;border:1px solid #14181C;display:flex;box-shadow:8px 10px 0 rgba(20,24,28,.06);}
.k-modal-rule{width:4px;background:#B23A2A;flex:none;}
.k-modal-body{padding:20px 18px 16px;flex:1;}
.k-modal-title{font-family:"Songti SC",serif;font-size:19px;font-weight:600;letter-spacing:.08em;}
.k-modal-sub{margin-top:5px;font-size:10px;color:#8F9088;}
.k-modal-code{position:relative;margin-top:14px;height:42px;border-bottom:1px solid #14181C;display:flex;align-items:center;font-family:Menlo,monospace;font-size:14px;letter-spacing:.14em;color:#14181C;}
.k-modal-code i{position:absolute;right:0;top:10px;width:1px;height:20px;background:#B23A2A;}
.k-modal-hint{margin-top:6px;font-size:9.5px;color:#A8A79B;}
.k-modal-actions{display:flex;gap:8px;margin-top:16px;}
.k-modal-actions span{flex:1;height:38px;border:1px solid #D8D4C8;display:flex;align-items:center;justify-content:center;font-size:11.5px;color:#4E5149;}
.k-modal-actions span.ok{background:#B23A2A;border-color:#B23A2A;color:#F3F1EA;}

.k-spec{padding:18px;height:380px;}
.k-spec-title{font-size:11px;letter-spacing:.16em;color:#6E7068;}
.k-spec-ruler{display:flex;justify-content:space-between;align-items:flex-end;height:34px;margin-top:10px;}
.k-spec-ruler span{width:3px;height:9px;background:#D8D4C8;}
.k-spec-ruler span.ev{height:18px;background:#8D8F87;}
.k-spec-ruler span.today{height:32px;background:#B23A2A;}
.k-spec-row{display:flex;align-items:baseline;gap:8px;padding:8px 0;border-bottom:1px solid #EAE6DB;}
.k-spec-row span{width:34px;flex:none;font-size:9px;color:#A8A79B;}
.k-spec-row i{margin-left:auto;font-style:normal;font-size:8px;color:#B5B2A7;}
.k-t56{font-family:"Songti SC",serif;font-size:40px;font-weight:600;line-height:.9;}
.k-t34{font-family:"Songti SC",serif;font-size:24px;font-weight:600;line-height:1;}
.k-t14{font-size:12px;}
.k-t12{font-size:10px;color:#6E7068;}
.k-spec-hair{height:1px;background:#14181C;margin-top:10px;}
.k-spec-colors{display:flex;height:26px;margin-top:10px;border:1px solid #D8D4C8;}
.k-spec-colors span{flex:1;}
.k-spec-caps{margin-top:8px;font-size:8.5px;line-height:1.6;color:#8F9088;letter-spacing:.02em;}

.k-share{position:absolute;z-index:2;}
.k-share-label-board{font-size:11px;letter-spacing:.12em;color:#9FA096;margin-bottom:10px;}
.k-share-art{width:220px;height:176px;background:#F3F1EA;padding:15px 16px;position:relative;overflow:hidden;display:flex;flex-direction:column;justify-content:space-between;}
.k-share-sun{position:absolute;right:-34px;top:-34px;width:110px;height:110px;border-radius:50%;background:#B23A2A;}
.k-share-art img{width:34px;height:34px;display:block;position:relative;z-index:1;}
.k-share-title{font-family:"Songti SC",serif;font-size:19px;font-weight:600;line-height:1.35;color:#14181C;letter-spacing:.03em;position:relative;z-index:1;}
.k-share-meta{font-size:8.5px;letter-spacing:.14em;color:#8F9088;position:relative;z-index:1;}
;
`;
